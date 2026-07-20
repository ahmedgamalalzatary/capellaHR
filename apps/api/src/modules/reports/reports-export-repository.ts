import {
  reportFiltersSchema,
  reportSelectionSchema,
  type CreateReportExportInput,
  type ListReportExportsQuery,
} from '@capella/contracts';
import { reportExports } from '@capella/database/schema';
import { and, asc, count, eq, gte, isNotNull, lt, lte, sql } from 'drizzle-orm';

import type { Database } from '../payroll/financial-repository-helpers.js';
import { currentAuditRequestId, writeAudit } from '../audit/index.js';
import type { ReportExportRecord, ReportExportRepository } from './reports-service.js';

type Executor = Parameters<Parameters<Database['transaction']>[0]>[0];

const toRecord = (row: typeof reportExports.$inferSelect): ReportExportRecord => ({
  ...row,
  filters: reportFiltersSchema.parse(row.filters),
  selection: reportSelectionSchema.parse(row.selection),
});

const findRecord = async (executor: Database | Executor, id: number) => {
  const row = (await executor.select().from(reportExports)
    .where(eq(reportExports.id, id)).limit(1))[0];
  return row ? toRecord(row) : null;
};

const requireRecord = async (executor: Database | Executor, id: number) => {
  const record = await findRecord(executor, id);
  if (!record) throw new Error(`Report export ${id} no longer exists`);
  return record;
};

const findLockedRecord = async (transaction: Executor, id: number) => {
  const row = (await transaction.select().from(reportExports)
    .where(eq(reportExports.id, id)).for('update').limit(1))[0];
  return row ? toRecord(row) : null;
};

const requireLockedRecord = async (transaction: Executor, id: number) => {
  const record = await findLockedRecord(transaction, id);
  if (!record) throw new Error(`Report export ${id} no longer exists`);
  return record;
};

const auditState = (record: ReportExportRecord) => Object.fromEntries(
  Object.entries(record).filter(([key]) => key !== 'filePath' && key !== 'fileSha256'),
);

const writeExportAudit = (
  transaction: Executor,
  action: string,
  before: ReportExportRecord | null,
  after: ReportExportRecord,
  createdAt: Date,
) => writeAudit(transaction, {
  requestId: currentAuditRequestId() ?? after.originRequestId,
  module: 'reports', action, entityType: 'report_export', entityId: after.id,
  beforeState: before ? auditState(before) : undefined,
  afterState: auditState(after),
  relatedIds: { exportId: after.id }, createdAt,
});

export const createDrizzleReportExportRepository = (
  database: Database,
): ReportExportRepository => ({
  async create(input: CreateReportExportInput, queuedAt: Date) {
    return database.transaction(async (transaction) => {
      const inserted = await transaction.insert(reportExports).values({
        reportType: input.reportType,
        filters: input.filters,
        selection: input.selection,
        originRequestId: currentAuditRequestId(),
        queuedAt,
        createdAt: queuedAt,
        updatedAt: queuedAt,
      });
      const record = await requireRecord(transaction, Number(inserted[0].insertId));
      await writeExportAudit(transaction, 'export_create', null, record, queuedAt);
      return record;
    });
  },

  findById(id) {
    return findRecord(database, id);
  },

  async list(query: ListReportExportsQuery) {
    const filters = [
      ...(query.reportType ? [eq(reportExports.reportType, query.reportType)] : []),
      ...(query.status ? [eq(reportExports.status, query.status)] : []),
    ];
    const where = filters.length ? and(...filters) : undefined;
    const rows = await database.select().from(reportExports).where(where)
      .orderBy(asc(reportExports.createdAt), asc(reportExports.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() }).from(reportExports).where(where);
    return { items: rows.map(toRecord), total: totals[0]?.value ?? 0 };
  },

  async recoverStale(staleBefore, recoveredAt) {
    return database.transaction(async (transaction) => {
      const stale = and(eq(reportExports.status, 'processing'), lte(reportExports.startedAt, staleBefore));
      const records = (await transaction.select().from(reportExports).where(stale).for('update')).map(toRecord);
      await transaction.update(reportExports).set({
        status: 'failed', failureReason: 'WORKER_INTERRUPTED', failedAt: recoveredAt, updatedAt: recoveredAt,
      }).where(and(stale, gte(reportExports.cycleAttemptCount, 3)));
      await transaction.update(reportExports).set({
        status: 'queued', failureReason: 'WORKER_INTERRUPTED', failedAt: recoveredAt,
        queuedAt: recoveredAt, startedAt: null, updatedAt: recoveredAt,
      }).where(and(stale, lt(reportExports.cycleAttemptCount, 3)));
      for (const before of records) {
        const after = await requireRecord(transaction, before.id);
        await writeExportAudit(transaction, 'export_recover', before, after, recoveredAt);
      }
      return records.length;
    });
  },

  claimNext(startedAt) {
    return database.transaction(async (transaction) => {
      const row = (await transaction.select({ id: reportExports.id }).from(reportExports)
        .where(eq(reportExports.status, 'queued'))
        .orderBy(asc(reportExports.queuedAt), asc(reportExports.id))
        .for('update').limit(1))[0];
      if (!row) return null;
      const before = await requireRecord(transaction, row.id);
      await transaction.update(reportExports).set({
        status: 'processing',
        attemptCount: sql`${reportExports.attemptCount} + 1`,
        cycleAttemptCount: sql`${reportExports.cycleAttemptCount} + 1`,
        startedAt,
        updatedAt: startedAt,
      }).where(and(eq(reportExports.id, row.id), eq(reportExports.status, 'queued')));
      const after = await requireRecord(transaction, row.id);
      await writeExportAudit(transaction, 'export_processing', before, after, startedAt);
      return after;
    });
  },

  retryFailed(id, queuedAt) {
    return database.transaction(async (transaction) => {
      const current = await findLockedRecord(transaction, id);
      if (current?.status !== 'failed') return null;
      const requestId = currentAuditRequestId();
      await transaction.update(reportExports).set({
        status: 'queued',
        filePath: null,
        fileSha256: null,
        fileSizeBytes: null,
        rowCount: null,
        cycleAttemptCount: 0,
        retryCount: sql`${reportExports.retryCount} + 1`,
        ...(requestId ? { originRequestId: requestId } : {}),
        queuedAt,
        startedAt: null,
        completedAt: null,
        fileDeletedAt: null,
        updatedAt: queuedAt,
      }).where(eq(reportExports.id, id));
      const after = await requireRecord(transaction, id);
      await writeExportAudit(transaction, 'export_retry', current, after, queuedAt);
      return after;
    });
  },

  complete(id, result, completedAt) {
    return database.transaction(async (transaction) => {
      const current = await requireLockedRecord(transaction, id);
      if (current?.status !== 'processing') {
        throw new Error(`Report export ${id} is not processing`);
      }
      await transaction.update(reportExports).set({
        status: 'completed',
        ...result,
        completedAt,
        updatedAt: completedAt,
      }).where(eq(reportExports.id, id));
      const after = await requireRecord(transaction, id);
      await writeExportAudit(transaction, 'export_complete', current, after, completedAt);
      return after;
    });
  },

  recordFailure(id, reason, failedAt) {
    return database.transaction(async (transaction) => {
      const current = await requireLockedRecord(transaction, id);
      if (current?.status !== 'processing') {
        throw new Error(`Report export ${id} is not processing`);
      }
      const exhausted = current.cycleAttemptCount >= 3;
      await transaction.update(reportExports).set({
        status: exhausted ? 'failed' : 'queued',
        failureReason: reason,
        failedAt,
        updatedAt: failedAt,
      }).where(eq(reportExports.id, id));
      const after = await requireRecord(transaction, id);
      await writeExportAudit(transaction, 'export_failure', current, after, failedAt);
      return after;
    });
  },

  markFileDeleted(id, deletedAt) {
    return database.transaction(async (transaction) => {
      const current = await requireLockedRecord(transaction, id);
      if (current?.status !== 'completed' || !current.filePath || current.fileDeletedAt) {
        throw new Error(`Report export ${id} has no deletable file`);
      }
      const requestId = currentAuditRequestId();
      await transaction.update(reportExports).set({
        fileDeletedAt: deletedAt,
        ...(requestId ? { originRequestId: requestId } : {}),
        updatedAt: deletedAt,
      }).where(eq(reportExports.id, id));
      const after = await requireRecord(transaction, id);
      await writeExportAudit(transaction, 'file_delete_mark', current, after, deletedAt);
      return after;
    });
  },

  clearDeletedFilePath(id, storagePath, updatedAt) {
    return database.transaction(async (transaction) => {
      const current = await requireLockedRecord(transaction, id);
      if (!current?.fileDeletedAt || current.filePath !== storagePath) {
        throw new Error(`Report export ${id} has no matching pending file deletion`);
      }
      await transaction.update(reportExports).set({
        filePath: null,
        updatedAt,
      }).where(eq(reportExports.id, id));
      const after = await requireRecord(transaction, id);
      await writeExportAudit(transaction, 'file_delete_complete', current, after, updatedAt);
      return after;
    });
  },

  async listPendingFileDeletes() {
    return database.select({ id: reportExports.id, filePath: reportExports.filePath })
      .from(reportExports).where(and(
        isNotNull(reportExports.fileDeletedAt),
        isNotNull(reportExports.filePath),
      )) as Promise<Array<{ id: number; filePath: string }>>;
  },

  async listReferencedFilePaths() {
    const rows = await database.select({ filePath: reportExports.filePath }).from(reportExports)
      .where(isNotNull(reportExports.filePath));
    return rows.flatMap((row) => row.filePath === null ? [] : [row.filePath]);
  },
});
