import {
  auditEvents,
  branches,
  reportExports,
} from '@capella/database/schema';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDrizzleReportExportRepository,
  createDrizzleReportReader,
} from '../../src/modules/reports/index.js';
import { runWithAuditContext } from '../../src/modules/audit/index.js';
import {
  database,
  now,
  clear,
  seed,
} from './reports-mysql-fixtures.js';

beforeEach(clear);
afterAll(clear);

describe('MySQL-backed report exports', () => {
  it('lists the newest export jobs first', async () => {
    await seed();
    const repository = createDrizzleReportExportRepository(database);
    const older = await repository.create({
      reportType: 'employees', filters: {}, selection: { mode: 'all' },
    }, now);
    const newerAt = new Date(now.getTime() + 1_000);
    const newer = await repository.create({
      reportType: 'employees', filters: {}, selection: { mode: 'all' },
    }, newerAt);

    await expect(repository.list({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      items: [{ id: newer.id }, { id: older.id }],
    });
  });

  it('walks an unrestricted export in bounded batches inside one snapshot transaction', async () => {
    await seed();
    await database.insert(branches).values(Array.from({ length: 125 }, (_, index) => ({
      name: `Export branch ${index}`,
      nameNormalized: `export-branch-${index}`,
      location: 'Cairo',
      latitude: 30,
      longitude: 31,
      gpsAccuracyMeters: 5,
      attendanceRadiusMeters: 50,
      createdAt: now,
      updatedAt: now,
    })));
    const reader = createDrizzleReportReader(database);
    const batchSizes: number[] = [];

    const result = await reader.readBatches(
      'branches', {}, { mode: 'all' }, 25, now,
      async (rows) => { batchSizes.push(rows.length); },
    );

    expect(result).toMatchObject({ kind: 'success', total: 126, rowCount: 126 });
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(25);
    expect(batchSizes.length).toBeGreaterThan(1);
  });

  it('claims exports once, retries three times, and retains metadata after file deletion', async () => {
    await seed();
    const repository = createDrizzleReportExportRepository(database);
    const created = await repository.create({
      reportType: 'employees', filters: {}, selection: { mode: 'all' },
    }, now);

    const claims = await Promise.all([
      repository.claimNext(now),
      repository.claimNext(now),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);

    await expect(repository.recordFailure(created.id, 'PDF_EXPORT_FAILED', now))
      .resolves.toMatchObject({ status: 'queued', attemptCount: 1, cycleAttemptCount: 1 });
    await repository.claimNext(now);
    await expect(repository.recordFailure(created.id, 'PDF_EXPORT_FAILED', now))
      .resolves.toMatchObject({ status: 'queued', attemptCount: 2, cycleAttemptCount: 2 });
    await repository.claimNext(now);
    await expect(repository.recordFailure(created.id, 'PDF_EXPORT_FAILED', now))
      .resolves.toMatchObject({ status: 'failed', attemptCount: 3, cycleAttemptCount: 3 });

    const manualRetries = await Promise.all([
      repository.retryFailed(created.id, now),
      repository.retryFailed(created.id, now),
    ]);
    expect(manualRetries.filter(Boolean)).toHaveLength(1);
    expect(manualRetries.filter((record) => record === null)).toHaveLength(1);
    await expect(repository.findById(created.id)).resolves.toMatchObject({
      status: 'queued',
      attemptCount: 3,
      cycleAttemptCount: 0,
      retryCount: 1,
      failureReason: 'PDF_EXPORT_FAILED',
      startedAt: null,
      failedAt: now,
    });

    await database.update(reportExports).set({
      status: 'completed',
      filePath: 'reports/1.pdf',
      fileSha256: 'c'.repeat(64),
      fileSizeBytes: 123,
      rowCount: 2,
      completedAt: now,
    }).where(eq(reportExports.id, created.id));
    const deleted = await repository.markFileDeleted(created.id, now);
    expect(deleted).toMatchObject({
      status: 'completed',
      filePath: 'reports/1.pdf',
      fileSha256: 'c'.repeat(64),
      fileSizeBytes: 123,
      rowCount: 2,
      fileDeletedAt: now,
    });
    await expect(repository.listPendingFileDeletes()).resolves.toEqual([
      { id: created.id, filePath: 'reports/1.pdf' },
    ]);
    await expect(repository.clearDeletedFilePath(created.id, 'reports/1.pdf', now))
      .resolves.toMatchObject({ filePath: null, fileDeletedAt: now });
    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'reports')).orderBy(asc(auditEvents.id));
    expect(events.map(({ action }) => action)).toEqual([
      'export_create',
      'export_processing', 'export_failure',
      'export_processing', 'export_failure',
      'export_processing', 'export_failure',
      'export_retry', 'file_delete_mark', 'file_delete_complete',
    ]);
    expect(events.at(-1)).toMatchObject({
      entityType: 'report_export', entityId: String(created.id),
    });
    expect(events.at(-1)?.afterState).not.toHaveProperty('filePath');
  });

  it('keeps the initiating request ID on background export transitions', async () => {
    await seed();
    const repository = createDrizzleReportExportRepository(database);
    const created = await runWithAuditContext({
      actorType: 'admin', actorIdentifier: 'admin', requestId: 'request-export-17',
      ipAddress: '127.0.0.1', userAgent: 'Vitest',
    }, () => repository.create({
      reportType: 'employees', filters: {}, selection: { mode: 'all' },
    }, now));

    await repository.claimNext(now);
    await repository.recordFailure(created.id, 'PDF_EXPORT_FAILED', now);

    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.entityId, String(created.id))).orderBy(asc(auditEvents.id));
    expect(events.map(({ action, requestId }) => ({ action, requestId }))).toEqual([
      { action: 'export_create', requestId: 'request-export-17' },
      { action: 'export_processing', requestId: 'request-export-17' },
      { action: 'export_failure', requestId: 'request-export-17' },
    ]);
  });

  it('keeps a file-deletion request ID when maintenance completes deletion later', async () => {
    await seed();
    const repository = createDrizzleReportExportRepository(database);
    const created = await runWithAuditContext({
      actorType: 'admin', actorIdentifier: 'admin', requestId: 'request-export-create',
      ipAddress: '127.0.0.1', userAgent: 'Vitest',
    }, () => repository.create({
      reportType: 'employees', filters: {}, selection: { mode: 'all' },
    }, now));
    await database.update(reportExports).set({
      status: 'completed', filePath: 'reports/correlated.pdf', fileSha256: 'a'.repeat(64),
      fileSizeBytes: 10, rowCount: 1, completedAt: now,
    }).where(eq(reportExports.id, created.id));

    await runWithAuditContext({
      actorType: 'admin', actorIdentifier: 'admin', requestId: 'request-file-delete',
      ipAddress: '127.0.0.1', userAgent: 'Vitest',
    }, () => repository.markFileDeleted(created.id, now));
    await repository.clearDeletedFilePath(created.id, 'reports/correlated.pdf', now);

    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.entityId, String(created.id))).orderBy(asc(auditEvents.id));
    expect(events.slice(-2).map(({ action, requestId }) => ({ action, requestId }))).toEqual([
      { action: 'file_delete_mark', requestId: 'request-file-delete' },
      { action: 'file_delete_complete', requestId: 'request-file-delete' },
    ]);
  });

  it('recovers interrupted jobs without exceeding the three-attempt ceiling', async () => {
    await seed();
    const repository = createDrizzleReportExportRepository(database);
    const retryable = await repository.create({
      reportType: 'employees', filters: {}, selection: { mode: 'all' },
    }, now);
    const exhausted = await repository.create({
      reportType: 'branches', filters: {}, selection: { mode: 'all' },
    }, now);
    const stale = new Date('2026-07-19T07:00:00.000Z');
    await database.update(reportExports).set({
      status: 'processing', attemptCount: 1, cycleAttemptCount: 1, startedAt: stale,
    }).where(eq(reportExports.id, retryable.id));
    await database.update(reportExports).set({
      status: 'processing', attemptCount: 3, cycleAttemptCount: 3, startedAt: stale,
    }).where(eq(reportExports.id, exhausted.id));

    await expect(repository.recoverStale(now, now)).resolves.toBe(2);
    await expect(repository.findById(retryable.id)).resolves.toMatchObject({
      status: 'queued', attemptCount: 1, cycleAttemptCount: 1, failureReason: 'WORKER_INTERRUPTED',
    });
    await expect(repository.findById(exhausted.id)).resolves.toMatchObject({
      status: 'failed', attemptCount: 3, cycleAttemptCount: 3, failureReason: 'WORKER_INTERRUPTED',
    });
  });
});
