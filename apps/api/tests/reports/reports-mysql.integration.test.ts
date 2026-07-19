import { createDatabase } from '@capella/database';
import {
  advanceInstallments,
  advances,
  attendanceDailyRecords,
  authSessions,
  bonuses,
  branches,
  deductions,
  deviceAuthenticationChallenges,
  deviceHistory,
  devicePairingRequests,
  devices,
  employeeCodeSequence,
  employeeImages,
  employeePhoneReservations,
  employeeSalaryPeriods,
  employees,
  payrollMonths,
  reportExports,
} from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDrizzleReportExportRepository,
  createDrizzleReportReader,
} from '../../src/modules/reports/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const now = new Date('2026-07-19T08:00:00.000Z');

const clear = async () => {
  await database.delete(reportExports);
  await database.delete(advanceInstallments);
  await database.delete(advances);
  await database.delete(bonuses);
  await database.delete(deductions);
  await database.delete(payrollMonths);
  await database.delete(employeeSalaryPeriods);
  await database.delete(attendanceDailyRecords);
  await database.delete(deviceAuthenticationChallenges);
  await database.delete(deviceHistory);
  await database.delete(devices);
  await database.delete(devicePairingRequests);
  await database.delete(authSessions);
  await database.delete(employeeImages);
  await database.delete(employeePhoneReservations);
  await database.delete(employees);
  await database.delete(employeeCodeSequence);
  await database.delete(branches);
};
beforeEach(clear);
afterAll(clear);

const seed = async () => {
  const branchId = Number((await database.insert(branches).values({
    name: 'فرع القاهرة',
    nameNormalized: 'cairo-report-branch',
    location: 'وسط البلد',
    latitude: 30.0444,
    longitude: 31.2357,
    gpsAccuracyMeters: 4,
    attendanceRadiusMeters: 50,
    hasEverBeenReferenced: true,
    createdAt: now,
    updatedAt: now,
  }))[0].insertId);
  const employeeId = Number((await database.insert(employees).values({
    employeeCode: 1,
    fullName: 'أحمد علي',
    personalPhone: '01000000001',
    whatsappPhone: '01100000001',
    pinHash: 'must-never-appear',
    credentialVersion: 1,
    age: 30,
    address: 'القاهرة',
    branchId,
    shiftDurationMinutes: 600,
    monthlyBaseSalary: '6000.00',
    createdAt: now,
    updatedAt: now,
  }))[0].insertId);
  const deletedEmployeeId = Number((await database.insert(employees).values({
    employeeCode: 2,
    fullName: 'موظف محذوف',
    personalPhone: '01000000002',
    whatsappPhone: '01100000002',
    pinHash: 'deleted-pin-hash',
    credentialVersion: 2,
    age: 35,
    address: 'الجيزة',
    branchId,
    shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00',
    deletedAt: now,
    createdAt: now,
    updatedAt: now,
  }))[0].insertId);
  await database.insert(devices).values({
    assignmentType: 'employee',
    employeeId,
    credentialId: 'must-never-appear-credential',
    credentialIdHash: 'a'.repeat(64),
    credentialPublicKey: 'must-never-appear-public-key',
    counter: 0,
    transports: ['internal'],
    credentialDeviceType: 'singleDevice',
    credentialBackedUp: false,
    installationMarkerHash: 'b'.repeat(64),
    browser: 'Mobile Safari',
    platform: 'iOS',
    status: 'active',
    pairedAt: now,
  });
  await database.insert(attendanceDailyRecords).values({
    employeeId: deletedEmployeeId,
    attendanceDate: '2026-07-12',
    status: 'weekly_day_off',
    absenceRequiredMinutes: 480,
    dayOffConvertedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(bonuses).values({
    employeeId,
    payrollMonth: '2026-07-01',
    amount: '100.00',
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(deductions).values({
    employeeId: deletedEmployeeId,
    payrollMonth: '2026-07-01',
    amount: '25.00',
    createdAt: now,
    updatedAt: now,
  });
  const advanceId = Number((await database.insert(advances).values({
    employeeId,
    amount: '80.00',
    installmentCount: 2,
    startMonth: '2026-07-01',
    createdAt: now,
    updatedAt: now,
  }))[0].insertId);
  await database.insert(advanceInstallments).values([
    { advanceId, employeeId, ordinal: 1, payrollMonth: '2026-07-01', amount: '40.00', createdAt: now },
    { advanceId, employeeId, ordinal: 2, payrollMonth: '2026-08-01', amount: '40.00', createdAt: now },
  ]);
  return { branchId, employeeId, deletedEmployeeId, advanceId };
};

describe('MySQL-backed reports', () => {
  it('cleans employee-owned residue before deleting shared fixtures', async () => {
    const { employeeId } = await seed();
    await database.insert(employeeImages).values({
      employeeId,
      kind: 'personal',
      storagePath: 'tests/reports/residue.png',
      originalName: 'residue.png',
      mimeType: 'image/png',
      sizeBytes: 1,
      createdAt: now,
      updatedAt: now,
    });

    await expect(clear()).resolves.toBeUndefined();
    await expect(database.select().from(employees)).resolves.toHaveLength(0);
  });

  it('returns fixed safe snapshots for every currently available report tab', async () => {
    const ids = await seed();
    const reader = createDrizzleReportReader(database);
    const available = [
      'branches', 'employees', 'devices', 'shifts', 'weekly-day-off',
      'bonuses', 'deductions', 'advances',
    ] as const;

    for (const reportType of available) {
      const result = await reader.read(reportType, {}, { mode: 'all' }, null, now);
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') continue;
      expect(result.snapshot.reportType).toBe(reportType);
      expect(result.snapshot.columns.length).toBeGreaterThan(0);
      expect(result.snapshot.summary.totalRecords).toBe(result.snapshot.rows.length);
      const serialized = JSON.stringify(result.snapshot);
      expect(serialized).not.toContain('must-never-appear');
      expect(serialized).not.toContain('pinHash');
      expect(serialized).not.toContain('credentialId');
      expect(serialized).not.toContain('installationMarker');
    }

    const employeesResult = await reader.read('employees', { branchId: ids.branchId }, {
      mode: 'selected', ids: [ids.deletedEmployeeId],
    }, { page: 1, pageSize: 20 }, now);
    expect(employeesResult).toMatchObject({
      kind: 'success',
      total: 1,
      snapshot: {
        rows: [expect.objectContaining({ employeeCode: 2, isDeleted: true })],
      },
    });
    await expect(reader.read('attendance', {}, { mode: 'all' }, null, now))
      .resolves.toEqual({ kind: 'unavailable' });
    await expect(reader.read('payroll', {}, { mode: 'all' }, null, now))
      .resolves.toEqual({ kind: 'unavailable' });
  });

  it('uses Cairo calendar boundaries for timestamp filters', async () => {
    await seed();
    const insideId = Number((await database.insert(branches).values({
      name: 'Cairo midnight report branch',
      nameNormalized: 'cairo-midnight-report-branch',
      location: 'Cairo',
      latitude: 30,
      longitude: 31,
      gpsAccuracyMeters: 5,
      attendanceRadiusMeters: 50,
      createdAt: new Date('2026-07-18T21:30:00.000Z'),
      updatedAt: new Date('2026-07-18T21:30:00.000Z'),
    }))[0].insertId);
    const outsideId = Number((await database.insert(branches).values({
      name: 'Previous Cairo day report branch',
      nameNormalized: 'previous-cairo-day-report-branch',
      location: 'Cairo',
      latitude: 30,
      longitude: 31,
      gpsAccuracyMeters: 5,
      attendanceRadiusMeters: 50,
      createdAt: new Date('2026-07-18T20:30:00.000Z'),
      updatedAt: new Date('2026-07-18T20:30:00.000Z'),
    }))[0].insertId);
    const reader = createDrizzleReportReader(database);

    const result = await reader.read('branches', {
      dateFrom: '2026-07-19',
      dateTo: '2026-07-19',
    }, { mode: 'selected', ids: [insideId, outsideId] }, null, now);

    expect(result).toMatchObject({
      kind: 'success',
      total: 1,
      snapshot: { rows: [expect.objectContaining({ id: insideId })] },
    });

    const winterInsideId = Number((await database.insert(branches).values({
      name: 'Cairo winter midnight report branch',
      nameNormalized: 'cairo-winter-midnight-report-branch',
      location: 'Cairo',
      latitude: 30,
      longitude: 31,
      gpsAccuracyMeters: 5,
      attendanceRadiusMeters: 50,
      createdAt: new Date('2026-01-18T22:30:00.000Z'),
      updatedAt: new Date('2026-01-18T22:30:00.000Z'),
    }))[0].insertId);
    const winter = await reader.read('branches', {
      dateFrom: '2026-01-19',
      dateTo: '2026-01-19',
    }, { mode: 'selected', ids: [winterInsideId] }, null, now);
    expect(winter).toMatchObject({ kind: 'success', total: 1 });

    const beforeDstDayId = Number((await database.insert(branches).values({
      name: 'Before Cairo DST report branch',
      nameNormalized: 'before-cairo-dst-report-branch',
      location: 'Cairo',
      latitude: 30,
      longitude: 31,
      gpsAccuracyMeters: 5,
      attendanceRadiusMeters: 50,
      createdAt: new Date('2026-04-23T21:30:00.000Z'),
      updatedAt: new Date('2026-04-23T21:30:00.000Z'),
    }))[0].insertId);
    const dstDayId = Number((await database.insert(branches).values({
      name: 'Cairo DST report branch',
      nameNormalized: 'cairo-dst-report-branch',
      location: 'Cairo',
      latitude: 30,
      longitude: 31,
      gpsAccuracyMeters: 5,
      attendanceRadiusMeters: 50,
      createdAt: new Date('2026-04-23T22:00:00.000Z'),
      updatedAt: new Date('2026-04-23T22:00:00.000Z'),
    }))[0].insertId);
    const dstStart = await reader.read('branches', {
      dateFrom: '2026-04-24',
      dateTo: '2026-04-24',
    }, { mode: 'selected', ids: [beforeDstDayId, dstDayId] }, null, now);
    expect(dstStart).toMatchObject({
      kind: 'success',
      total: 1,
      snapshot: { rows: [expect.objectContaining({ id: dstDayId })] },
    });
  });

  it('matches advances when any installment overlaps the selected month range', async () => {
    await seed();
    const reader = createDrizzleReportReader(database);

    const august = await reader.read('advances', {
      monthFrom: '2026-08',
      monthTo: '2026-08',
    }, { mode: 'all' }, null, now);
    const september = await reader.read('advances', {
      monthFrom: '2026-09',
      monthTo: '2026-09',
    }, { mode: 'all' }, null, now);

    expect(august).toMatchObject({ kind: 'success', total: 1 });
    expect(september).toMatchObject({ kind: 'success', total: 0 });
  });

  it('filters advances by the rewritten installment schedule after deletion acceleration', async () => {
    const { advanceId } = await seed();
    await database.delete(advanceInstallments).where(eq(advanceInstallments.advanceId, advanceId));
    await database.insert(advanceInstallments).values({
      advanceId,
      employeeId: (await database.select({ employeeId: advances.employeeId }).from(advances)
        .where(eq(advances.id, advanceId)).limit(1))[0]!.employeeId,
      ordinal: 1,
      payrollMonth: '2026-10-01',
      amount: '80.00',
      createdAt: now,
    });
    const reader = createDrizzleReportReader(database);

    await expect(reader.read('advances', {
      monthFrom: '2026-08', monthTo: '2026-08',
    }, { mode: 'all' }, null, now)).resolves.toMatchObject({ kind: 'success', total: 0 });
    await expect(reader.read('advances', {
      monthFrom: '2026-10', monthTo: '2026-10',
    }, { mode: 'all' }, null, now)).resolves.toMatchObject({ kind: 'success', total: 1 });
  });

  it('reads every snapshot row and aggregate inside one database transaction', async () => {
    await seed();
    let transactionCount = 0;
    let transactionOptions: unknown;
    const controlled = new Proxy(database, {
      get(target, property, receiver) {
        if (property !== 'transaction') {
          const value: unknown = Reflect.get(target, property, receiver);
          return value;
        }
        return (...args: Parameters<typeof database.transaction>) => {
          transactionCount += 1;
          transactionOptions = args[1];
          return database.transaction(...args);
        };
      },
    });
    const reader = createDrizzleReportReader(controlled);

    await expect(reader.read('advances', {}, { mode: 'all' }, null, now))
      .resolves.toMatchObject({ kind: 'success', total: 1 });
    expect(transactionCount).toBe(1);
    expect(transactionOptions).toMatchObject({ isolationLevel: 'repeatable read', accessMode: 'read only' });
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
    });
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
