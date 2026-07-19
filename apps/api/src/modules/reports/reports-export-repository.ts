import {
  reportFiltersSchema,
  reportSelectionSchema,
  type CreateReportExportInput,
  type ListReportExportsQuery,
} from '@capella/contracts';
import { reportExports } from '@capella/database/schema';
import { and, asc, count, eq, gte, isNotNull, lt, lte, sql } from 'drizzle-orm';

import type { Database } from '../payroll/financial-repository-helpers.js';
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

export const createDrizzleReportExportRepository = (
  database: Database,
): ReportExportRepository => ({
  async create(input: CreateReportExportInput, queuedAt: Date) {
    const inserted = await database.insert(reportExports).values({
      reportType: input.reportType,
      filters: input.filters,
      selection: input.selection,
      queuedAt,
      createdAt: queuedAt,
      updatedAt: queuedAt,
    });
    return requireRecord(database, Number(inserted[0].insertId));
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
    const stale = and(
      eq(reportExports.status, 'processing'),
      lte(reportExports.startedAt, staleBefore),
    );
    const exhausted = await database.update(reportExports).set({
      status: 'failed',
      failureReason: 'WORKER_INTERRUPTED',
      failedAt: recoveredAt,
      updatedAt: recoveredAt,
    }).where(and(stale, gte(reportExports.cycleAttemptCount, 3)));
    const retryable = await database.update(reportExports).set({
      status: 'queued',
      failureReason: 'WORKER_INTERRUPTED',
      failedAt: recoveredAt,
      queuedAt: recoveredAt,
      startedAt: null,
      updatedAt: recoveredAt,
    }).where(and(stale, lt(reportExports.cycleAttemptCount, 3)));
    return exhausted[0].affectedRows + retryable[0].affectedRows;
  },

  claimNext(startedAt) {
    return database.transaction(async (transaction) => {
      const row = (await transaction.select({ id: reportExports.id }).from(reportExports)
        .where(eq(reportExports.status, 'queued'))
        .orderBy(asc(reportExports.queuedAt), asc(reportExports.id))
        .for('update').limit(1))[0];
      if (!row) return null;
      await transaction.update(reportExports).set({
        status: 'processing',
        attemptCount: sql`${reportExports.attemptCount} + 1`,
        cycleAttemptCount: sql`${reportExports.cycleAttemptCount} + 1`,
        startedAt,
        updatedAt: startedAt,
      }).where(and(eq(reportExports.id, row.id), eq(reportExports.status, 'queued')));
      return requireRecord(transaction, row.id);
    });
  },

  retryFailed(id, queuedAt) {
    return database.transaction(async (transaction) => {
      const current = (await transaction.select({ status: reportExports.status })
        .from(reportExports).where(eq(reportExports.id, id)).for('update').limit(1))[0];
      if (current?.status !== 'failed') return null;
      await transaction.update(reportExports).set({
        status: 'queued',
        filePath: null,
        fileSha256: null,
        fileSizeBytes: null,
        rowCount: null,
        cycleAttemptCount: 0,
        retryCount: sql`${reportExports.retryCount} + 1`,
        queuedAt,
        startedAt: null,
        completedAt: null,
        fileDeletedAt: null,
        updatedAt: queuedAt,
      }).where(eq(reportExports.id, id));
      return requireRecord(transaction, id);
    });
  },

  complete(id, result, completedAt) {
    return database.transaction(async (transaction) => {
      const current = (await transaction.select({ status: reportExports.status })
        .from(reportExports).where(eq(reportExports.id, id)).for('update').limit(1))[0];
      if (current?.status !== 'processing') {
        throw new Error(`Report export ${id} is not processing`);
      }
      await transaction.update(reportExports).set({
        status: 'completed',
        ...result,
        completedAt,
        updatedAt: completedAt,
      }).where(eq(reportExports.id, id));
      return requireRecord(transaction, id);
    });
  },

  recordFailure(id, reason, failedAt) {
    return database.transaction(async (transaction) => {
      const current = (await transaction.select({
        status: reportExports.status,
        cycleAttemptCount: reportExports.cycleAttemptCount,
      }).from(reportExports).where(eq(reportExports.id, id)).for('update').limit(1))[0];
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
      return requireRecord(transaction, id);
    });
  },

  markFileDeleted(id, deletedAt) {
    return database.transaction(async (transaction) => {
      const current = (await transaction.select({
        status: reportExports.status,
        filePath: reportExports.filePath,
        fileDeletedAt: reportExports.fileDeletedAt,
      }).from(reportExports).where(eq(reportExports.id, id)).for('update').limit(1))[0];
      if (current?.status !== 'completed' || !current.filePath || current.fileDeletedAt) {
        throw new Error(`Report export ${id} has no deletable file`);
      }
      await transaction.update(reportExports).set({
        fileDeletedAt: deletedAt,
        updatedAt: deletedAt,
      }).where(eq(reportExports.id, id));
      return requireRecord(transaction, id);
    });
  },

  clearDeletedFilePath(id, storagePath, updatedAt) {
    return database.transaction(async (transaction) => {
      const current = (await transaction.select({
        filePath: reportExports.filePath,
        fileDeletedAt: reportExports.fileDeletedAt,
      }).from(reportExports).where(eq(reportExports.id, id)).for('update').limit(1))[0];
      if (!current?.fileDeletedAt || current.filePath !== storagePath) {
        throw new Error(`Report export ${id} has no matching pending file deletion`);
      }
      await transaction.update(reportExports).set({
        filePath: null,
        updatedAt,
      }).where(eq(reportExports.id, id));
      return requireRecord(transaction, id);
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
