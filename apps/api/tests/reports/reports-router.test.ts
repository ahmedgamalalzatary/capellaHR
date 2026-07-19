/* eslint-disable @typescript-eslint/unbound-method */
import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import {
  ReportError,
  type ReportExportRecord,
  type ReportService,
} from '../../src/modules/reports/index.js';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const pipelineControl = vi.hoisted(() => ({ failWith: null as Error | null }));

vi.mock('node:stream/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:stream/promises')>();
  return {
    ...actual,
    pipeline: async (...streams: unknown[]) => {
      if (pipelineControl.failWith) {
        const response = streams.at(-1) as { write(chunk: Buffer): void; destroy(): void };
        response.write(Buffer.from('%PDF'));
        response.destroy();
        const error = pipelineControl.failWith;
        pipelineControl.failWith = null;
        throw error;
      }
      await Reflect.apply(actual.pipeline, undefined, streams);
    },
  };
});

const at = new Date('2026-07-19T08:00:00.000Z');
const exportRecord: ReportExportRecord = {
  id: 11,
  reportType: 'employees',
  status: 'completed',
  filters: { branchId: 3 },
  selection: { mode: 'all' },
  filePath: 'reports/11.pdf',
  fileSha256: 'a'.repeat(64),
  fileSizeBytes: 4,
  rowCount: 1,
  attemptCount: 1,
  cycleAttemptCount: 1,
  retryCount: 0,
  failureReason: null,
  queuedAt: at,
  startedAt: at,
  completedAt: at,
  failedAt: null,
  fileDeletedAt: null,
  createdAt: at,
  updatedAt: at,
};
const auth = (actorType: 'admin' | 'employee' | null = 'admin') => ({
  authenticate: vi.fn(async () => actorType === null ? null : {
    actorType,
    employeeId: actorType === 'employee' ? 1 : null,
  }),
}) as unknown as AuthService;
const service = (): ReportService => ({
  view: vi.fn(async () => ({
    kind: 'success' as const,
    total: 1,
    snapshot: {
      reportType: 'employees' as const,
      title: 'تقرير الموظفين',
      generatedAt: at.toISOString(),
      columns: [{ key: 'employeeCode', label: 'الكود' }],
      rows: [{ employeeCode: 1 }],
      summary: { totalRecords: 1 },
    },
  })),
  createExport: vi.fn(async () => exportRecord),
  listExports: vi.fn(async () => ({ items: [exportRecord], total: 1 })),
  getExport: vi.fn(async () => exportRecord),
  retryExport: vi.fn(async () => ({ ...exportRecord, status: 'queued' as const, cycleAttemptCount: 0, retryCount: 1 })),
  download: vi.fn(async () => ({ stream: Readable.from(Buffer.from('%PDF')), filename: 'employees-report-11.pdf' })),
  deleteFile: vi.fn(async () => ({ ...exportRecord, filePath: null, fileDeletedAt: at })),
  reconcileFiles: vi.fn(async () => ({ deletedFiles: 0, orphanFiles: 0 })),
});

describe('reports HTTP API', () => {
  it('requires an authenticated admin for every report operation', async () => {
    const unauthenticated = createApp({ authService: auth(null), reportService: service() });
    const employee = createApp({ authService: auth('employee'), reportService: service() });

    expect((await request(unauthenticated).get('/api/v1/reports/employees')).status).toBe(401);
    expect((await request(employee).post('/api/v1/reports/exports')
      .set('Cookie', 'capella_session=x').send({
        reportType: 'employees', filters: {}, selection: { mode: 'all' },
      })).status).toBe(403);
  });

  it('parses report filters and returns snapshot pagination metadata', async () => {
    const reports = service();
    const response = await request(createApp({ authService: auth(), reportService: reports }))
      .get('/api/v1/reports/employees?branchId=3&selection=selected&selectedIds=5,7&page=2&pageSize=25')
      .set('Cookie', 'capella_session=x');

    expect(response.status).toBe(200);
    expect(reports.view).toHaveBeenCalledWith('employees', {
      branchId: 3,
      selection: 'selected',
      selectedIds: [5, 7],
      page: 2,
      pageSize: 25,
    });
    expect(response.body).toMatchObject({
      data: { reportType: 'employees', rows: [{ employeeCode: 1 }] },
      meta: { page: 2, pageSize: 25, total: 1, totalPages: 1 },
    });
  });

  it('creates and lists immutable PDF export jobs', async () => {
    const reports = service();
    const app = createApp({ authService: auth(), reportService: reports });
    const input = { reportType: 'employees', filters: { branchId: 3 }, selection: { mode: 'all' } };

    const created = await request(app).post('/api/v1/reports/exports')
      .set('Cookie', 'capella_session=x').send(input);
    const listed = await request(app).get('/api/v1/reports/exports?status=completed&page=1&pageSize=20')
      .set('Cookie', 'capella_session=x');

    expect(created.status).toBe(202);
    expect(reports.createExport).toHaveBeenCalledWith(input);
    expect(listed.status).toBe(200);
    expect(reports.listExports).toHaveBeenCalledWith({ status: 'completed', page: 1, pageSize: 20 });
    expect(listed.body.meta.total).toBe(1);
  });

  it('downloads a private PDF and deletes only its stored file', async () => {
    const reports = service();
    const app = createApp({ authService: auth(), reportService: reports });

    const downloaded = await request(app).get('/api/v1/reports/exports/11/download')
      .set('Cookie', 'capella_session=x');
    const deleted = await request(app).delete('/api/v1/reports/exports/11/file')
      .set('Cookie', 'capella_session=x');

    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['content-type']).toContain('application/pdf');
    expect(downloaded.headers['content-disposition']).toContain('employees-report-11.pdf');
    expect(Buffer.from(downloaded.body).toString()).toBe('%PDF');
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toMatchObject({ id: 11, filePath: null });
  });

  it('does not write a JSON error after PDF streaming has started', async () => {
    const reports = service();
    pipelineControl.failWith = new ReportError('REPORT_FILE_MISSING');
    const status = vi.spyOn(express.response, 'status');
    try {
      await request(createApp({ authService: auth(), reportService: reports }))
        .get('/api/v1/reports/exports/11/download')
        .set('Cookie', 'capella_session=x')
        .catch(() => undefined);

      expect(status).not.toHaveBeenCalled();
    } finally {
      pipelineControl.failWith = null;
      status.mockRestore();
    }
  });

  it('retries a failed PDF export through an admin-only lifecycle endpoint', async () => {
    const reports = service();
    const response = await request(createApp({ authService: auth(), reportService: reports }))
      .post('/api/v1/reports/exports/11/retry')
      .set('Cookie', 'capella_session=x');

    expect(response.status).toBe(202);
    expect(reports.retryExport).toHaveBeenCalledWith(11);
    expect(response.body.data).toMatchObject({ id: 11, status: 'queued', attemptCount: 1, cycleAttemptCount: 0, retryCount: 1 });
  });

  it('returns stable validation and lifecycle errors', async () => {
    const reports = service();
    vi.mocked(reports.view).mockRejectedValue(new ReportError('REPORT_SOURCE_UNAVAILABLE'));
    const app = createApp({ authService: auth(), reportService: reports });

    const invalid = await request(app).get('/api/v1/reports/not-a-report')
      .set('Cookie', 'capella_session=x');
    const unavailable = await request(app).get('/api/v1/reports/attendance')
      .set('Cookie', 'capella_session=x').set('x-request-id', 'reports-test');

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.error).toMatchObject({
      code: 'REPORT_SOURCE_UNAVAILABLE', requestId: 'reports-test',
    });
  });

  it('rejects a filter that the requested report tab would ignore', async () => {
    const reports = service();
    const response = await request(createApp({ authService: auth(), reportService: reports }))
      .get('/api/v1/reports/bonuses?deviceStatus=active')
      .set('Cookie', 'capella_session=x');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(reports.view).not.toHaveBeenCalled();
  });
});
