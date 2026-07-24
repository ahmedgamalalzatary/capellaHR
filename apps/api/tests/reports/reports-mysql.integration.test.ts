import { createDatabase } from '@capella/database';
import {
  advanceInstallments,
  advances,
  auditEvents,
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceSessions,
  authSessions,
  bonuses,
  branches,
  deductions,
  deviceHistory,
  devicePairingRequests,
  devices,
  employeeBranchAssignments,
  employeeCodeSequence,
  employeeImages,
  employeePhoneReservations,
  employeeSalaryPeriods,
  employees,
  payrollMonths,
  reportExports,
} from '@capella/database/schema';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDrizzleReportExportRepository,
  createDrizzleReportReader,
} from '../../src/modules/reports/index.js';
import { runWithAuditContext } from '../../src/modules/audit/index.js';
import { createDrizzleAttendanceRepository } from '../../src/modules/attendance/index.js';
import { createPayrollModule } from '../../src/modules/payroll/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const now = new Date('2026-07-19T08:00:00.000Z');

const clear = async () => {
  await database.delete(auditEvents);
  await database.delete(reportExports);
  await database.delete(advanceInstallments);
  await database.delete(advances);
  await database.delete(bonuses);
  await database.delete(deductions);
  await database.delete(payrollMonths);
  await database.delete(employeeSalaryPeriods);
  await database.delete(attendanceDeniedAttempts);
  await database.delete(attendanceDailyRecords);
  await database.delete(attendanceSessions);
  await database.delete(deviceHistory);
  await database.delete(devices);
  await database.delete(devicePairingRequests);
  await database.delete(authSessions);
  await database.delete(employeeImages);
  await database.delete(employeePhoneReservations);
  await database.delete(employeeBranchAssignments);
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
  await database.insert(employeeBranchAssignments).values([
    { employeeId, branchId, effectiveFrom: now, createdAt: now },
    { employeeId: deletedEmployeeId, branchId, effectiveFrom: now, createdAt: now },
  ]);
  await database.insert(devices).values({
    assignmentType: 'employee',
    employeeId,
    installationMarkerHash: 'b'.repeat(64),
    browser: 'Mobile Safari',
    platform: 'iOS',
    status: 'active',
    pairedAt: now,
  });
  await database.insert(attendanceDailyRecords).values({
    employeeId: deletedEmployeeId,
    branchId,
    attendanceDate: '2026-07-12',
    status: 'weekly_day_off',
    absenceRequiredMinutes: 480,
    dayOffConvertedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(attendanceSessions).values({
    employeeId,
    branchId,
    attendanceDate: '2026-07-19',
    requiredMinutes: 600,
    checkInAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(bonuses).values({
    employeeId,
    payrollMonth: '2026-07-01',
    amount: '100.00',
    reason: 'أداء استثنائي',
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
  it('keeps historical report rows and branch filters under the original branch', async () => {
    const { branchId, employeeId, deletedEmployeeId } = await seed();
    const newBranchId = Number((await database.insert(branches).values({
      name: 'New report branch', nameNormalized: 'new-report-branch', location: 'Giza',
      latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50,
      hasEverBeenReferenced: true, createdAt: now, updatedAt: now,
    }))[0].insertId);
    const reassignedAt = new Date(now.getTime() + 60_000);
    for (const reassignedEmployeeId of [employeeId, deletedEmployeeId]) {
      await database.update(employeeBranchAssignments).set({ effectiveTo: reassignedAt })
        .where(and(eq(employeeBranchAssignments.employeeId, reassignedEmployeeId), eq(employeeBranchAssignments.branchId, branchId)));
      await database.insert(employeeBranchAssignments).values({ employeeId: reassignedEmployeeId, branchId: newBranchId, effectiveFrom: reassignedAt, createdAt: reassignedAt });
      await database.update(employees).set({ branchId: newBranchId, updatedAt: reassignedAt })
        .where(eq(employees.id, reassignedEmployeeId));
    }
    const reader = createDrizzleReportReader(database);

    for (const reportType of ['attendance', 'weekly-day-off', 'bonuses', 'deductions', 'advances'] as const) {
      const oldBranch = await reader.read(reportType, { branchId }, { mode: 'all' }, null, reassignedAt);
      expect(oldBranch).toMatchObject({
        kind: 'success',
        total: reportType === 'attendance' ? 2 : 1,
        snapshot: { rows: expect.arrayContaining([expect.objectContaining({ branchId })]) },
      });
      await expect(reader.read(reportType, { branchId: newBranchId }, { mode: 'all' }, null, reassignedAt))
        .resolves.toMatchObject({ kind: 'success', total: 0 });
    }
  });
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
      'attendance', 'bonuses', 'deductions', 'advances',
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
      expect(serialized).not.toContain('installationMarkerHash');
      expect(serialized).not.toContain('installationMarker');
      if (reportType === 'employees') {
        expect(result.snapshot.rows[0]?.monthlyBaseSalary).toBe('6000.00');
      }
      if (reportType === 'bonuses') {
        expect(result.snapshot.rows[0]?.amount).toBe('100.00');
        expect(result.snapshot.rows[0]?.reason).toBe('أداء استثنائي');
        expect(result.snapshot.columns).toContainEqual({ key: 'reason', label: 'سبب المكافأة' });
        expect(result.snapshot.summary.totalAmount).toBe('100.00');
      }
      if (reportType === 'deductions') {
        expect(result.snapshot.rows[0]?.amount).toBe('25.00');
        expect(result.snapshot.summary.totalAmount).toBe('25.00');
      }
      if (reportType === 'advances') {
        expect(result.snapshot.rows[0]?.amount).toBe('80.00');
        expect(result.snapshot.summary.totalAmount).toBe('80.00');
      }
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
    await expect(reader.read('payroll', {}, { mode: 'all' }, null, now))
      .resolves.toEqual({ kind: 'unavailable' });
  });

  it('reports attendance facts without denied attempts and includes open and finalized payroll status', async () => {
    const { branchId, employeeId, deletedEmployeeId } = await seed();
    await database.delete(attendanceSessions).where(eq(attendanceSessions.employeeId, employeeId));
    await database.insert(attendanceSessions).values({
      employeeId,
      branchId,
      attendanceDate: '2026-07-19',
      requiredMinutes: 600,
      checkInAt: new Date('2026-07-19T05:00:00.000Z'),
      checkOutAt: new Date('2026-07-19T15:30:00.000Z'),
      workedMinutes: 630,
      overtimeMinutes: 30,
      shortageMinutes: 0,
      automaticTimeoutAt: null,
      automaticTimeoutCorrectedAt: null,
      flagged: false,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(attendanceDailyRecords).values({
      employeeId: deletedEmployeeId,
      branchId,
      attendanceDate: '2026-07-11',
      status: 'absence',
      absenceRequiredMinutes: 480,
      createdAt: now,
      updatedAt: now,
    });
    await database.insert(attendanceDeniedAttempts).values({
      eventType: 'check_in', claimedEmployeeCode: 1, employeeId,
      source: 'personal_device', occurredAt: now,
      failureReason: 'DEVICE_INVALID', suspicious: true, createdAt: now,
    });
    await database.insert(payrollMonths).values({
      employeeId,
      payrollMonth: '2026-07-01',
      status: 'finalized',
      baseSalary: '6000.00',
      proratedBase: '6000.00',
      overtimeAmount: '10.00',
      bonusAmount: '100.00',
      attendanceDeductionAmount: '0.00',
      manualDeductionAmount: '0.00',
      advanceAmount: '40.00',
      priorNegativeCarry: '0.00',
      netSalary: '6070.00',
      eligibleWorkdays: 1,
      fullMonthWorkdays: 30,
      requiredMinutes: 600,
      overtimeMinutes: 30,
      shortageMinutes: 0,
      finalizedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const attendance = createDrizzleAttendanceRepository(database, {
      now: () => now,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: () => Promise.resolve(600),
    });
    const payroll = createPayrollModule(database, { now: () => now, attendance });
    let payrollPreviewCount = 0;
    const reader = createDrizzleReportReader(database, {
      now: () => now,
      payroll: {
        preview: (targetEmployeeId, month, context) => {
          payrollPreviewCount += 1;
          return payroll.repository.previewInContext(targetEmployeeId, month, attendance, context);
        },
      },
    });

    const attendanceResult = await reader.read('attendance', {
      dateFrom: '2026-07-01', dateTo: '2026-07-31',
    }, { mode: 'all' }, null, now);
    expect(attendanceResult).toMatchObject({
      kind: 'success',
      total: 3,
      snapshot: {
        summary: { attendanceRecords: 1, absenceRecords: 1, weeklyDayOffRecords: 1 },
      },
    });
    expect(JSON.stringify(attendanceResult)).not.toContain('DEVICE_INVALID');

    const payrollResult = await reader.read('payroll', {
      monthFrom: '2026-07', monthTo: '2026-07',
    }, { mode: 'all' }, null, now);
    expect(payrollResult).toMatchObject({
      kind: 'success',
      total: 2,
      snapshot: {
        rows: expect.arrayContaining([
          expect.objectContaining({ employeeId, payrollMonth: '2026-07', status: 'finalized' }),
          expect.objectContaining({ employeeId: deletedEmployeeId, payrollMonth: '2026-07', status: 'open' }),
        ]),
        summary: { finalizedRecords: 1, openRecords: 1, totalNetSalary: '6045.00' },
      },
    });

    const attendanceBatches: unknown[] = [];
    await expect(reader.readBatches(
      'attendance', { dateFrom: '2026-07-01', dateTo: '2026-07-31' },
      { mode: 'all' }, 2, now,
      async (rows) => { attendanceBatches.push(...rows); },
    )).resolves.toMatchObject({ kind: 'success', total: 3, rowCount: 3 });
    expect(attendanceBatches).toHaveLength(3);

    const payrollBatches: Array<Record<string, unknown>> = [];
    payrollPreviewCount = 0;
    await expect(reader.readBatches(
      'payroll', { monthFrom: '2026-07', monthTo: '2026-07' },
      { mode: 'all' }, 1, now,
      async (rows) => { payrollBatches.push(...rows); },
    )).resolves.toMatchObject({ kind: 'success', total: 2, rowCount: 2 });
    expect(payrollBatches.map(({ status }) => status)).toEqual(['finalized', 'open']);
    expect(payrollPreviewCount).toBe(2);

    const boundedReader = createDrizzleReportReader(database, {
      now: () => now,
      maxInteractivePayrollCandidates: 1,
      payroll: {
        preview: (targetEmployeeId, month, context) => {
          payrollPreviewCount += 1;
          return payroll.repository.previewInContext(targetEmployeeId, month, attendance, context);
        },
      },
    });
    payrollPreviewCount = 0;
    await expect(boundedReader.read(
      'payroll', { monthFrom: '2026-07', monthTo: '2026-07' },
      { mode: 'all' }, { page: 1, pageSize: 1 }, now,
    )).resolves.toEqual({ kind: 'unavailable' });
    expect(payrollPreviewCount).toBe(0);
    await expect(boundedReader.read(
      'payroll', { monthFrom: '2026-07', monthTo: '2026-07' },
      { mode: 'all' }, { page: 1, pageSize: 1, purpose: 'availability' }, now,
    )).resolves.toMatchObject({ kind: 'success' });
    expect(payrollPreviewCount).toBe(0);
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
