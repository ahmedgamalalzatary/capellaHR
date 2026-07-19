import type {
  CreateReportExportInput,
  ReportSnapshot,
} from '@capella/contracts';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  createReportProcessor,
  createReportService,
  type ReportExportRecord,
  type ReportExportRepository,
  type ReportFileStore,
  type ReportReader,
} from '../../src/modules/reports/index.js';

const now = new Date('2026-07-19T08:00:00.000Z');
const snapshot: ReportSnapshot = {
  reportType: 'employees',
  title: 'تقرير الموظفين',
  generatedAt: now.toISOString(),
  columns: [{ key: 'employeeCode', label: 'كود الموظف' }],
  rows: [{ employeeCode: 1 }],
  summary: { totalRecords: 1 },
};
const queued: ReportExportRecord = {
  id: 1,
  reportType: 'employees',
  status: 'queued',
  filters: {},
  selection: { mode: 'all' },
  filePath: null,
  fileSha256: null,
  fileSizeBytes: null,
  rowCount: null,
  attemptCount: 0,
  cycleAttemptCount: 0,
  retryCount: 0,
  failureReason: null,
  queuedAt: now,
  startedAt: null,
  completedAt: null,
  failedAt: null,
  fileDeletedAt: null,
  createdAt: now,
  updatedAt: now,
};

const createReader = (result: ReportSnapshot | 'unavailable' = snapshot): ReportReader => ({
  async read(reportType, _filters, _selection, _pagination, generatedAt) {
    if (result === 'unavailable') return { kind: 'unavailable' };
    return {
      kind: 'success',
      snapshot: { ...result, reportType, generatedAt: generatedAt.toISOString() },
      total: result.rows.length,
    };
  },
  async readBatches(reportType, _filters, _selection, _batchSize, generatedAt, onBatch) {
    if (result === 'unavailable') return { kind: 'unavailable' };
    await onBatch(result.rows);
    const { rows, ...header } = { ...result, reportType, generatedAt: generatedAt.toISOString() };
    return { kind: 'success', snapshot: header, total: rows.length, rowCount: rows.length };
  },
});

const createRepository = (overrides: Partial<ReportExportRepository> = {}): ReportExportRepository => ({
  create: async () => queued,
  findById: async () => queued,
  list: async () => ({ items: [queued], total: 1 }),
  recoverStale: async () => 0,
  claimNext: async () => ({ ...queued, status: 'processing', attemptCount: 1, startedAt: now }),
  retryFailed: async () => ({ ...queued, status: 'queued', cycleAttemptCount: 0, retryCount: 1 }),
  complete: async (_id, result, completedAt) => ({
    ...queued,
    status: 'completed',
    ...result,
    attemptCount: 1,
    startedAt: now,
    completedAt,
    updatedAt: completedAt,
  }),
  recordFailure: async (_id, reason, failedAt) => ({
    ...queued,
    status: 'queued',
    attemptCount: 1,
    failureReason: reason,
    failedAt,
    updatedAt: failedAt,
  }),
  markFileDeleted: async (_id, deletedAt) => ({
    ...queued,
    status: 'completed',
    filePath: 'reports/1.pdf',
    fileSha256: 'a'.repeat(64),
    fileSizeBytes: 4,
    rowCount: 1,
    completedAt: now,
    fileDeletedAt: deletedAt,
    updatedAt: deletedAt,
  }),
  clearDeletedFilePath: async (_id, _path, updatedAt) => ({
    ...queued,
    status: 'completed',
    filePath: null,
    fileDeletedAt: now,
    completedAt: now,
    updatedAt,
  }),
  listPendingFileDeletes: async () => [],
  listReferencedFilePaths: async () => [],
  ...overrides,
});

const createStore = (events: string[] = []): ReportFileStore => ({
  save: async (_id, write) => {
    const output = new PassThrough();
    output.resume();
    await write(output);
    return { storagePath: 'reports/1.pdf', sha256: 'a'.repeat(64), sizeBytes: 4 };
  },
  openRead: async () => Readable.from(Buffer.from('%PDF')),
  createSpool: async () => {
    const batches: ReportSnapshot['rows'][] = [];
    return {
      append: async (rows) => { batches.push(rows); },
      rows: async function* () { yield* batches; },
      dispose: async () => undefined,
    };
  },
  delete: async () => { events.push('delete'); },
  removeOrphans: async () => 0,
});

describe('reports service', () => {
  it('fails explicitly when a deferred report source is unavailable', async () => {
    const service = createReportService(createReader('unavailable'), createRepository(), createStore(), () => now);

    await expect(service.view('attendance', { selection: 'all', page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ code: 'REPORT_SOURCE_UNAVAILABLE' });
  });

  it('queues only an available report with immutable filters and selection', async () => {
    let captured: CreateReportExportInput | undefined;
    const repository = createRepository({
      create: async (input) => {
        captured = input;
        return { ...queued, reportType: input.reportType, filters: input.filters, selection: input.selection };
      },
    });
    const service = createReportService(createReader(), repository, createStore(), () => now);

    await expect(service.createExport({
      reportType: 'employees',
      filters: { branchId: 2 },
      selection: { mode: 'selected', ids: [5, 8] },
    })).resolves.toMatchObject({ status: 'queued' });
    expect(captured).toEqual({
      reportType: 'employees',
      filters: { branchId: 2 },
      selection: { mode: 'selected', ids: [5, 8] },
    });
  });

  it('claims, snapshots, renders, stores, and completes one PDF export', async () => {
    let completed: Parameters<ReportExportRepository['complete']> | undefined;
    const repository = createRepository({
      complete: async (...input) => {
        completed = input;
        return { ...queued, status: 'completed', filePath: input[1].filePath };
      },
    });
    const processor = createReportProcessor(
      createReader(),
      repository,
      createStore(),
      async (input, output) => {
        expect(input.snapshot).toEqual(expect.objectContaining({ reportType: snapshot.reportType }));
        const rows = [];
        for await (const batch of input.rows()) rows.push(...batch);
        expect(rows).toEqual(snapshot.rows);
        output.end(Buffer.from('%PDF'));
      },
      () => now,
    );

    await expect(processor.processNext()).resolves.toMatchObject({ status: 'completed' });
    expect(completed?.[1]).toEqual({
      filePath: 'reports/1.pdf',
      fileSha256: 'a'.repeat(64),
      fileSizeBytes: 4,
      rowCount: 1,
    });
  });

  it('records a sanitized retryable failure without leaking the thrown message', async () => {
    let failureReason = '';
    const repository = createRepository({
      recordFailure: async (_id, reason) => {
        failureReason = reason;
        return { ...queued, status: 'queued', attemptCount: 1, failureReason: reason };
      },
    });
    const processor = createReportProcessor(
      createReader(), repository, createStore(), async () => { throw new Error('C:\\secret\\path SQL password'); }, () => now,
    );

    await expect(processor.processNext()).resolves.toMatchObject({ status: 'queued' });
    expect(failureReason).toBe('PDF_EXPORT_FAILED');
  });

  it('starts a new three-attempt cycle only for a failed export', async () => {
    const failed = { ...queued, status: 'failed' as const, attemptCount: 3, failedAt: now };
    const repository = createRepository({
      findById: async () => failed,
      retryFailed: async () => ({
        ...failed,
        status: 'queued',
        attemptCount: 3,
        cycleAttemptCount: 0,
        retryCount: 1,
        failureReason: 'PDF_EXPORT_FAILED',
        startedAt: null,
        failedAt: now,
      }),
    });
    const service = createReportService(createReader(), repository, createStore(), () => now);

    await expect(service.retryExport(1)).resolves.toMatchObject({
      id: 1,
      status: 'queued',
      attemptCount: 3,
      cycleAttemptCount: 0,
      retryCount: 1,
      filters: failed.filters,
      selection: failed.selection,
    });
  });

  it('recovers a successful completion when the commit response is lost', async () => {
    const completed = {
      ...queued,
      status: 'completed' as const,
      filePath: 'reports/1.pdf',
      fileSha256: 'a'.repeat(64),
      fileSizeBytes: 4,
      rowCount: 1,
      completedAt: now,
    };
    const repository = createRepository({
      complete: async () => { throw new Error('connection lost after commit'); },
      findById: async () => completed,
      recordFailure: async () => { throw new Error('must not retry a committed export'); },
    });
    const processor = createReportProcessor(
      createReader(), repository, createStore(), async (_input, output) => { output.end(Buffer.from('%PDF')); }, () => now,
    );

    await expect(processor.processNext()).resolves.toEqual(completed);
  });

  it('deletes the untracked PDF after the final failed completion attempt', async () => {
    const events: string[] = [];
    const repository = createRepository({
      complete: async () => { throw new Error('database unavailable'); },
      findById: async () => ({ ...queued, status: 'processing', attemptCount: 3 }),
      recordFailure: async () => ({
        ...queued,
        status: 'failed',
        attemptCount: 3,
        failureReason: 'PDF_EXPORT_FAILED',
        failedAt: now,
      }),
    });
    const processor = createReportProcessor(
      createReader(), repository, createStore(events), async (_input, output) => { output.end(Buffer.from('%PDF')); }, () => now,
    );

    await expect(processor.processNext()).resolves.toMatchObject({ status: 'failed' });
    expect(events).toEqual(['delete']);
  });

  it('deletes the untracked PDF before retrying a failed completion', async () => {
    const events: string[] = [];
    const repository = createRepository({
      complete: async () => { throw new Error('database unavailable'); },
      findById: async () => ({ ...queued, status: 'processing', attemptCount: 1 }),
      recordFailure: async () => ({
        ...queued,
        status: 'queued',
        attemptCount: 1,
        failureReason: 'PDF_EXPORT_FAILED',
        failedAt: now,
      }),
    });
    const processor = createReportProcessor(
      createReader(), repository, createStore(events), async (_input, output) => { output.end(Buffer.from('%PDF')); }, () => now,
    );

    await expect(processor.processNext()).resolves.toMatchObject({ status: 'queued' });
    expect(events).toEqual(['delete']);
  });

  it('leaves the live file untouched when persisting deletion metadata fails', async () => {
    const events: string[] = [];
    const completedExport = { ...queued, status: 'completed' as const, filePath: 'reports/1.pdf', completedAt: now };
    const repository = createRepository({
      findById: async () => completedExport,
      markFileDeleted: async () => { throw new Error('database unavailable'); },
    });
    const service = createReportService(createReader(), repository, createStore(events), () => now);

    await expect(service.deleteFile(1)).rejects.toThrow('database unavailable');
    expect(events).toEqual([]);
  });

  it('keeps a durable pending deletion when physical removal fails', async () => {
    const completedExport = { ...queued, status: 'completed' as const, filePath: 'reports/1.pdf', completedAt: now };
    const marked = { ...completedExport, fileDeletedAt: now };
    const repository = createRepository({
      findById: async () => completedExport,
      markFileDeleted: async () => marked,
      clearDeletedFilePath: async () => { throw new Error('must remain pending'); },
    });
    const store = createStore();
    store.delete = async () => { throw new Error('filesystem unavailable'); };
    const service = createReportService(createReader(), repository, store, () => now);

    await expect(service.deleteFile(1)).resolves.toEqual(marked);
  });

  it('resolves a lost database response after deletion metadata committed', async () => {
    const completedExport = { ...queued, status: 'completed' as const, filePath: 'reports/1.pdf', completedAt: now };
    const marked = { ...completedExport, fileDeletedAt: now };
    let reads = 0;
    const events: string[] = [];
    const repository = createRepository({
      findById: async () => reads++ === 0 ? completedExport : marked,
      markFileDeleted: async () => { throw new Error('connection lost after commit'); },
    });
    const service = createReportService(createReader(), repository, createStore(events), () => now);

    await expect(service.deleteFile(1)).resolves.toMatchObject({ filePath: null, fileDeletedAt: now });
    expect(events).toEqual(['delete']);
  });

  it('reconciles pending physical deletions and orphan files', async () => {
    const events: string[] = [];
    const repository = createRepository({
      listPendingFileDeletes: async () => [{ id: 1, filePath: 'reports/1.pdf' }],
      listReferencedFilePaths: async () => ['reports/2.pdf'],
      clearDeletedFilePath: async (_id, _path, updatedAt) => ({
        ...queued, status: 'completed', fileDeletedAt: now, updatedAt,
      }),
    });
    const store = createStore(events);
    store.removeOrphans = async (referenced) => {
      expect(referenced).toEqual(new Set(['reports/2.pdf']));
      events.push('orphans');
      return 2;
    };
    const service = createReportService(createReader(), repository, store, () => now);

    await expect(service.reconcileFiles(now)).resolves.toEqual({ deletedFiles: 1, orphanFiles: 2 });
    expect(events).toEqual(['delete', 'orphans']);
  });

  it('returns a private PDF only for a completed non-deleted export', async () => {
    const completedExport = {
      ...queued,
      status: 'completed' as const,
      filePath: 'reports/1.pdf',
      fileSha256: 'a'.repeat(64),
      fileSizeBytes: 4,
      rowCount: 1,
      completedAt: now,
    };
    const service = createReportService(createReader(), createRepository({
      findById: async () => completedExport,
    }), createStore(), () => now);

    await expect(service.download(1)).resolves.toEqual({
      stream: expect.any(Readable),
      filename: 'employees-report-1.pdf',
    });
  });
});
