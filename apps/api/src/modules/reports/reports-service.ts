import type {
  CreateReportExportInput,
  ListReportExportsQuery,
  ReportExportStatus,
  ReportFilters,
  ReportQuery,
  ReportSelection,
  ReportSnapshot,
  ReportType,
} from '@capella/contracts';
import { reportFilterCompatibilitySchema } from '@capella/contracts';
import type { Readable, Writable } from 'node:stream';

export type ReportExportRecord = {
  id: number;
  reportType: ReportType;
  status: ReportExportStatus;
  filters: ReportFilters;
  selection: ReportSelection;
  filePath: string | null;
  fileSha256: string | null;
  fileSizeBytes: number | null;
  rowCount: number | null;
  attemptCount: number;
  cycleAttemptCount: number;
  retryCount: number;
  originRequestId: string | null;
  failureReason: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  fileDeletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface ReportReader {
  read(
    reportType: ReportType,
    filters: ReportFilters,
    selection: ReportSelection,
    pagination: { page: number; pageSize: number; purpose?: 'screen' | 'availability' } | null,
    generatedAt: Date,
  ): Promise<{ kind: 'success'; snapshot: ReportSnapshot; total: number } | { kind: 'unavailable' }>;
  readBatches(
    reportType: ReportType,
    filters: ReportFilters,
    selection: ReportSelection,
    batchSize: number,
    generatedAt: Date,
    onBatch: (rows: ReportSnapshot['rows']) => Promise<void>,
  ): Promise<
    | { kind: 'success'; snapshot: Omit<ReportSnapshot, 'rows'>; total: number; rowCount: number }
    | { kind: 'unavailable' }
  >;
}

export interface ReportExportRepository {
  create(input: CreateReportExportInput, queuedAt: Date): Promise<ReportExportRecord>;
  findById(id: number): Promise<ReportExportRecord | null>;
  list(query: ListReportExportsQuery): Promise<{ items: ReportExportRecord[]; total: number }>;
  recoverStale(staleBefore: Date, recoveredAt: Date): Promise<number>;
  claimNext(startedAt: Date): Promise<ReportExportRecord | null>;
  retryFailed(id: number, queuedAt: Date): Promise<ReportExportRecord | null>;
  complete(id: number, result: {
    filePath: string;
    fileSha256: string;
    fileSizeBytes: number;
    rowCount: number;
  }, completedAt: Date): Promise<ReportExportRecord>;
  recordFailure(id: number, reason: string, failedAt: Date): Promise<ReportExportRecord>;
  markFileDeleted(id: number, deletedAt: Date): Promise<ReportExportRecord>;
  clearDeletedFilePath(id: number, storagePath: string, updatedAt: Date): Promise<ReportExportRecord>;
  listPendingFileDeletes(): Promise<Array<{ id: number; filePath: string }>>;
  listReferencedFilePaths(): Promise<string[]>;
}

export interface ReportFileStore {
  save(exportId: number, write: (output: Writable) => Promise<void>): Promise<{ storagePath: string; sha256: string; sizeBytes: number }>;
  openRead(storagePath: string): Promise<Readable>;
  createSpool(): Promise<{
    append(rows: ReportSnapshot['rows']): Promise<void>;
    rows(): AsyncIterable<ReportSnapshot['rows']>;
    dispose(): Promise<void>;
  }>;
  delete(storagePath: string): Promise<void>;
  removeOrphans(referenced: ReadonlySet<string>, staleBefore: Date): Promise<number>;
}

export type ReportErrorCode =
  | 'REPORT_SOURCE_UNAVAILABLE'
  | 'REPORT_EXPORT_NOT_FOUND'
  | 'REPORT_EXPORT_NOT_READY'
  | 'REPORT_EXPORT_NOT_FAILED'
  | 'REPORT_FILE_DELETED'
  | 'REPORT_FILE_MISSING';

const messages: Record<ReportErrorCode, string> = {
  REPORT_SOURCE_UNAVAILABLE: 'مصدر بيانات التقرير غير متاح حاليًا',
  REPORT_EXPORT_NOT_FOUND: 'ملف التصدير غير موجود',
  REPORT_EXPORT_NOT_READY: 'ملف التصدير لم يكتمل بعد',
  REPORT_EXPORT_NOT_FAILED: 'يمكن إعادة محاولة ملف تصدير فاشل فقط',
  REPORT_FILE_DELETED: 'تم حذف ملف PDF مع الاحتفاظ ببيانات التصدير',
  REPORT_FILE_MISSING: 'ملف PDF غير متاح في التخزين',
};

export class ReportError extends Error {
  constructor(public readonly code: ReportErrorCode) {
    super(messages[code]);
  }
}

const queryParts = (query: ReportQuery) => {
  const {
    selection,
    selectedIds,
    page,
    pageSize,
    ...filters
  } = query;
  const reportSelection: ReportSelection = selection === 'selected'
    ? { mode: 'selected', ids: selectedIds! }
    : { mode: 'all' };
  return { filters, selection: reportSelection, pagination: { page, pageSize } };
};

export const createReportService = (
  reader: ReportReader,
  exports: ReportExportRepository,
  files: ReportFileStore,
  now: () => Date = () => new Date(),
) => ({
  async view(reportType: ReportType, query: ReportQuery) {
    const input = queryParts(query);
    reportFilterCompatibilitySchema.parse({ reportType, filters: input.filters });
    const result = await reader.read(reportType, input.filters, input.selection, input.pagination, now());
    if (result.kind === 'unavailable') throw new ReportError('REPORT_SOURCE_UNAVAILABLE');
    return result;
  },

  async createExport(input: CreateReportExportInput) {
    reportFilterCompatibilitySchema.parse({ reportType: input.reportType, filters: input.filters });
    const available = await reader.read(input.reportType, input.filters, input.selection, {
      page: 1,
      pageSize: 1,
      purpose: 'availability',
    }, now());
    if (available.kind === 'unavailable') throw new ReportError('REPORT_SOURCE_UNAVAILABLE');
    return exports.create(input, now());
  },

  listExports(query: ListReportExportsQuery) {
    return exports.list(query);
  },

  async getExport(id: number) {
    const record = await exports.findById(id);
    if (!record) throw new ReportError('REPORT_EXPORT_NOT_FOUND');
    return record;
  },

  async retryExport(id: number) {
    const record = await this.getExport(id);
    if (record.status !== 'failed') throw new ReportError('REPORT_EXPORT_NOT_FAILED');
    const retried = await exports.retryFailed(id, now());
    if (!retried) throw new ReportError('REPORT_EXPORT_NOT_FAILED');
    return retried;
  },

  async download(id: number) {
    const record = await this.getExport(id);
    if (record.status !== 'completed') throw new ReportError('REPORT_EXPORT_NOT_READY');
    if (record.fileDeletedAt || !record.filePath) throw new ReportError('REPORT_FILE_DELETED');
    try {
      return {
        stream: await files.openRead(record.filePath),
        filename: `${record.reportType}-report-${record.id}.pdf`,
      };
    } catch {
      throw new ReportError('REPORT_FILE_MISSING');
    }
  },

  async deleteFile(id: number) {
    const record = await this.getExport(id);
    if (record.status !== 'completed') throw new ReportError('REPORT_EXPORT_NOT_READY');
    if (record.fileDeletedAt || !record.filePath) throw new ReportError('REPORT_FILE_DELETED');
    let marked: ReportExportRecord;
    try {
      marked = await exports.markFileDeleted(id, now());
    } catch (error) {
      const current = await exports.findById(id);
      if (!current?.fileDeletedAt) throw error;
      marked = current;
    }
    try {
      await files.delete(record.filePath);
      return await exports.clearDeletedFilePath(id, record.filePath, now());
    } catch {
      return marked;
    }
  },

  async reconcileFiles(staleBefore: Date) {
    let deletedFiles = 0;
    for (const pending of await exports.listPendingFileDeletes()) {
      try {
        await files.delete(pending.filePath);
        await exports.clearDeletedFilePath(pending.id, pending.filePath, now());
        deletedFiles += 1;
      } catch {
        // Leave the durable pending path for the next maintenance sweep.
      }
    }
    const referenced = new Set(await exports.listReferencedFilePaths());
    const orphanFiles = await files.removeOrphans(referenced, staleBefore);
    return { deletedFiles, orphanFiles };
  },
});

export type ReportService = ReturnType<typeof createReportService>;

export const createReportProcessor = (
  reader: ReportReader,
  exports: ReportExportRepository,
  files: ReportFileStore,
  render: (source: {
    snapshot: Omit<ReportSnapshot, 'rows'>;
    rows: () => AsyncIterable<ReportSnapshot['rows']>;
  }, output: Writable) => Promise<void>,
  now: () => Date = () => new Date(),
) => ({
  async processNext() {
    const job = await exports.claimNext(now());
    if (!job) return null;
    let stored: Awaited<ReturnType<ReportFileStore['save']>> | null = null;
    let spool: Awaited<ReturnType<ReportFileStore['createSpool']>> | null = null;
    try {
      spool = await files.createSpool();
      const result = await reader.readBatches(
        job.reportType,
        job.filters,
        job.selection,
        500,
        now(),
        (rows) => spool!.append(rows),
      );
      if (result.kind === 'unavailable') throw new ReportError('REPORT_SOURCE_UNAVAILABLE');
      stored = await files.save(job.id, (output) => render({
        snapshot: result.snapshot,
        rows: () => spool!.rows(),
      }, output));
      return await exports.complete(job.id, {
        filePath: stored.storagePath,
        fileSha256: stored.sha256,
        fileSizeBytes: stored.sizeBytes,
        rowCount: result.rowCount,
      }, now());
    } catch {
      if (stored) {
        const current = await exports.findById(job.id);
        if (current?.status === 'completed') {
          if (current.filePath !== stored.storagePath) await files.delete(stored.storagePath);
          return current;
        }
        await files.delete(stored.storagePath);
      }
      const failed = await exports.recordFailure(job.id, 'PDF_EXPORT_FAILED', now());
      return failed;
    } finally {
      await spool?.dispose().catch(() => undefined);
    }
  },
});

export type ReportProcessor = ReturnType<typeof createReportProcessor>;
