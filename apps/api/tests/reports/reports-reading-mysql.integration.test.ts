import {
  advanceInstallments,
  advances,
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceSessions,
  branches,
  employeeBranchAssignments,
  employeeImages,
  employees,
  payrollMonths,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDrizzleReportReader,
} from '../../src/modules/reports/index.js';
import { createDrizzleAttendanceRepository } from '../../src/modules/attendance/index.js';
import { createPayrollModule } from '../../src/modules/payroll/index.js';
import {
  database,
  now,
  clear,
  seed,
} from './reports-mysql-fixtures.js';

beforeEach(clear);
afterAll(clear);

describe('MySQL-backed reports reading', () => {
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
  it('exports payroll rows under the historical branch of the month like the interactive report', async () => {
    const { branchId, employeeId, deletedEmployeeId } = await seed();
    const newBranchId = Number((await database.insert(branches).values({
      name: 'Later payroll branch', nameNormalized: 'later-payroll-branch', location: 'Giza',
      latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50,
      hasEverBeenReferenced: true, createdAt: now, updatedAt: now,
    }))[0].insertId);
    // The employees move branch only in August, so July payroll still belongs to the old branch.
    const movedAt = new Date('2026-08-01T00:00:00.000Z');
    for (const movedEmployeeId of [employeeId, deletedEmployeeId]) {
      await database.update(employeeBranchAssignments).set({ effectiveTo: movedAt })
        .where(and(
          eq(employeeBranchAssignments.employeeId, movedEmployeeId),
          eq(employeeBranchAssignments.branchId, branchId),
        ));
      await database.insert(employeeBranchAssignments)
        .values({ employeeId: movedEmployeeId, branchId: newBranchId, effectiveFrom: movedAt, createdAt: movedAt });
      await database.update(employees).set({ branchId: newBranchId, updatedAt: movedAt })
        .where(eq(employees.id, movedEmployeeId));
    }
    const attendance = createDrizzleAttendanceRepository(database, {
      now: () => now,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: () => Promise.resolve(600),
    });
    const payroll = createPayrollModule(database, { now: () => now, attendance });
    const reader = createDrizzleReportReader(database, {
      now: () => now,
      payroll: {
        preview: (targetEmployeeId, month, context) =>
          payroll.repository.previewInContext(targetEmployeeId, month, attendance, context),
      },
    });
    const filters = { monthFrom: '2026-07', monthTo: '2026-07', branchId } as const;

    const interactive = await reader.read('payroll', filters, { mode: 'all' }, null, now);
    expect(interactive).toMatchObject({
      kind: 'success',
      total: 2,
      snapshot: { rows: expect.arrayContaining([expect.objectContaining({ branchId })]) },
    });
    if (interactive.kind !== 'success') return;

    const exported: Array<Record<string, unknown>> = [];
    const batched = await reader.readBatches(
      'payroll', filters, { mode: 'all' }, 1, now,
      async (rows) => { exported.push(...rows); },
    );

    expect(batched).toMatchObject({ kind: 'success', total: interactive.total, rowCount: interactive.total });
    expect(exported).toEqual(interactive.snapshot.rows);
    if (batched.kind !== 'success') return;
    expect(batched.snapshot.summary).toEqual(interactive.snapshot.summary);

    // The August branch must claim the same rows once the month moves with the assignment.
    await expect(reader.readBatches(
      'payroll', { ...filters, branchId: newBranchId }, { mode: 'all' }, 1, now,
      async () => {},
    )).resolves.toMatchObject({ kind: 'success', total: 0, rowCount: 0 });
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
      commissionAmount: '30.00',
      attendanceDeductionAmount: '0.00',
      manualDeductionAmount: '0.00',
      commissionDeductionAmount: '10.00',
      advanceAmount: '40.00',
      priorNegativeCarry: '0.00',
      netSalary: '6090.00',
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
          expect.objectContaining({
            employeeId, payrollMonth: '2026-07', status: 'finalized',
            commissionAmount: '30.00', commissionDeductionAmount: '10.00',
          }),
          expect.objectContaining({ employeeId: deletedEmployeeId, payrollMonth: '2026-07', status: 'open' }),
        ]),
        summary: { finalizedRecords: 1, openRecords: 1, totalNetSalary: '6065.00' },
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

  it('doubles the reported shortage of an absence marked without permission', async () => {
    const { branchId, employeeId } = await seed();
    await database.delete(attendanceSessions).where(eq(attendanceSessions.employeeId, employeeId));
    await database.delete(attendanceDailyRecords);
    await database.insert(attendanceDailyRecords).values([
      {
        employeeId, branchId, attendanceDate: '2026-07-10', status: 'absence',
        absenceRequiredMinutes: 480, withoutPermissionAt: null,
        createdAt: now, updatedAt: now,
      },
      {
        employeeId, branchId, attendanceDate: '2026-07-11', status: 'absence',
        absenceRequiredMinutes: 480, withoutPermissionAt: now,
        createdAt: now, updatedAt: now,
      },
    ]);
    const reader = createDrizzleReportReader(database, { now: () => now });

    const result = await reader.read('attendance', {
      dateFrom: '2026-07-01', dateTo: '2026-07-31',
    }, { mode: 'all' }, null, now);

    expect(result).toMatchObject({
      kind: 'success',
      snapshot: {
        summary: { absenceRecords: 2, totalShortageMinutes: 1440 },
        rows: expect.arrayContaining([
          expect.objectContaining({ attendanceDate: '2026-07-10', shortageMinutes: 480, withoutPermission: false }),
          expect.objectContaining({ attendanceDate: '2026-07-11', shortageMinutes: 960, withoutPermission: true }),
        ]),
      },
    });
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
});
