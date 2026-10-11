import {
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceSessions,
  auditEvents,
  employeeEmploymentPeriods,
  employees,
  financialAuditEvents,
  payrollMonths,
} from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPayrollModule } from '../../src/modules/payroll/index.js';
import {
  createFixtures,
  cleanDatabase,
  database,
  fixedNow,
  repository,
} from './attendance-mysql-fixtures.js';

beforeEach(cleanDatabase);
afterEach(async () => {
  await database.delete(financialAuditEvents);
  await cleanDatabase();
});

describe('MySQL-backed attendance payroll facts', () => {
  it('supplies transaction-aware monthly facts and blockers to Payroll', async () => {
    const { branchId, employeeId } = await createFixtures();
    await database.update(employees).set({
      createdAt: new Date('2026-05-31T21:00:00.000Z'),
      deletedAt: new Date('2026-06-28T09:00:00.000Z'),
    }).where(eq(employees.id, employeeId));
    const sessionDates = ['2026-06-01', '2026-06-10', '2026-06-28'] as const;
    await database.insert(attendanceSessions).values(sessionDates.map((attendanceDate, index) => ({
      employeeId,
      branchId,
      attendanceDate,
      requiredMinutes: 480,
      checkInAt: new Date(`${attendanceDate}T06:00:00.000Z`),
      checkOutAt: new Date(`${attendanceDate}T${index === 0 ? '14:20' : index === 1 ? '13:30' : '14:00'}:00.000Z`),
      workedMinutes: index === 0 ? 500 : index === 1 ? 450 : 480,
      overtimeMinutes: index === 0 ? 20 : 0,
      shortageMinutes: index === 1 ? 30 : 0,
      automaticTimeoutAt: null,
      automaticTimeoutCorrectedAt: null,
      flagged: false,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    })));
    const weeklyDays = new Set(['2026-06-07', '2026-06-14', '2026-06-21']);
    const dailyDates = Array.from({ length: 26 }, (_, index) => `2026-06-${String(index + 2).padStart(2, '0')}`)
      .filter((date) => date !== '2026-06-10');
    await database.insert(attendanceDailyRecords).values(dailyDates.map((attendanceDate) => ({
      employeeId,
      branchId,
      attendanceDate,
      status: weeklyDays.has(attendanceDate) ? 'weekly_day_off' as const : 'absence' as const,
      absenceRequiredMinutes: 480,
      dayOffConvertedAt: weeklyDays.has(attendanceDate) ? fixedNow : null,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    })));
    const repo = repository();

    await expect(database.transaction((transaction) => (
      repo.readPayrollFacts(employeeId, '2026-06', transaction, 'finalize')
    ))).resolves.toMatchObject({
      kind: 'ready',
      facts: {
        fullMonthWorkdays: 27,
        eligibleWorkdays: 25,
        requiredMinutes: 12_000,
        overtimeMinutes: 20,
        shortageMinutes: 10_590,
        attendanceSummary: {
          monthRequiredMinutes: 12000, requiredMinutesThroughDate: 12000,
          workedMinutes: 1430, actualShortageMinutes: 10570, actualOvertimeMinutes: 0,
          absenceDaysWithPermission: 22, absenceDaysWithoutPermission: 0,
          weeklyDayOffDays: 3, asOfDate: '2026-06-30', provisional: false,
        },
      },
    });
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance: repo });
    await expect(payroll.service.preview(employeeId, '2026-06')).resolves.toMatchObject({
      status: 'open',
      fullMonthWorkdays: 27,
      eligibleWorkdays: 25,
      requiredMinutes: 12_000,
      overtimeMinutes: 20,
      shortageMinutes: 10_590,
    });

    const deniedResult = await database.insert(attendanceDeniedAttempts).values({
      eventType: 'check_in', claimedEmployeeCode: 42, employeeId,
      source: 'personal_device', occurredAt: new Date('2026-06-15T08:00:00.000Z'),
      failureReason: 'DEVICE_INVALID', suspicious: true, createdAt: fixedNow,
    });
    await expect(database.transaction((transaction) => (
      repo.readPayrollFacts(employeeId, '2026-06', transaction, 'finalize')
    ))).resolves.toEqual({ kind: 'blocked', reasons: ['DENIED_ATTEMPT'] });

    await expect(payroll.service.preview(employeeId, '2026-06')).resolves.toMatchObject({
      status: 'open', requiredMinutes: 12_000,
    });
    await expect(payroll.service.finalize(employeeId, '2026-06'))
      .rejects.toMatchObject({ code: 'PAYROLL_BLOCKED', reasons: ['DENIED_ATTEMPT'] });

    await expect(repo.dismissDeniedAttempt(Number(deniedResult[0].insertId))).resolves.toMatchObject({
      kind: 'success', attempt: { dismissedAt: fixedNow },
    });
    await expect(database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'dismiss_denied_attempt'))).resolves.toEqual([
      expect.objectContaining({
        entityType: 'attendance_denied_attempt',
        entityId: String(deniedResult[0].insertId),
      }),
    ]);
    await expect(database.transaction((transaction) => (
      repo.readPayrollFacts(employeeId, '2026-06', transaction, 'finalize')
    ))).resolves.toMatchObject({ kind: 'ready' });
    await database.insert(attendanceDeniedAttempts).values({
      eventType: 'check_in', claimedEmployeeCode: 42, employeeId,
      source: 'personal_device', occurredAt: new Date('2026-06-10T08:00:00.000Z'),
      failureReason: 'SESSION_EXISTS', suspicious: false, createdAt: fixedNow,
    });
    await expect(database.transaction((transaction) => (
      repo.readPayrollFacts(employeeId, '2026-06', transaction, 'finalize')
    ))).resolves.toMatchObject({ kind: 'ready' });
  });

  it('charges an absence marked without permission twice without shifting the per-minute rate', async () => {
    const { branchId, employeeId } = await createFixtures();
    await database.update(employees).set({
      createdAt: new Date('2026-05-31T21:00:00.000Z'),
    }).where(eq(employees.id, employeeId));
    const workedDates = Array.from({ length: 28 }, (_, index) => `2026-06-${String(index + 1).padStart(2, '0')}`);
    await database.insert(attendanceSessions).values(workedDates.map((attendanceDate) => ({
      employeeId,
      branchId,
      attendanceDate,
      requiredMinutes: 480,
      checkInAt: new Date(`${attendanceDate}T06:00:00.000Z`),
      checkOutAt: new Date(`${attendanceDate}T14:00:00.000Z`),
      workedMinutes: 480,
      overtimeMinutes: 0,
      shortageMinutes: 0,
      automaticTimeoutAt: null,
      automaticTimeoutCorrectedAt: null,
      flagged: false,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    })));
    await database.insert(attendanceDailyRecords).values([
      {
        employeeId, branchId, attendanceDate: '2026-06-29', status: 'absence' as const,
        absenceRequiredMinutes: 480, withoutPermissionAt: null,
        createdAt: fixedNow, updatedAt: fixedNow,
      },
      {
        employeeId, branchId, attendanceDate: '2026-06-30', status: 'absence' as const,
        absenceRequiredMinutes: 480, withoutPermissionAt: fixedNow,
        createdAt: fixedNow, updatedAt: fixedNow,
      },
    ]);
    const repo = repository();

    await expect(database.transaction((transaction) => (
      repo.readPayrollFacts(employeeId, '2026-06', transaction, 'finalize')
    ))).resolves.toMatchObject({
      kind: 'ready',
      facts: {
        fullMonthWorkdays: 30,
        eligibleWorkdays: 30,
        requiredMinutes: 14_400,
        overtimeMinutes: 0,
        shortageMinutes: 1_440,
        attendanceSummary: {
          monthRequiredMinutes: 14400, requiredMinutesThroughDate: 14400,
          workedMinutes: 13440, actualShortageMinutes: 960, actualOvertimeMinutes: 0,
          absenceDaysWithPermission: 1, absenceDaysWithoutPermission: 1,
          weeklyDayOffDays: 0, asOfDate: '2026-06-30', provisional: false,
        },
      },
    });
  });

  it('counts missing past days as single-deduction absences without counting today or future days as absent', async () => {
    const { employeeId } = await createFixtures();
    const repo = repository();
    await expect(database.transaction((transaction) => (
      repo.readPayrollFacts(employeeId, '2026-07', transaction, 'preview')
    ))).resolves.toMatchObject({
      kind: 'ready',
      facts: {
        eligibleWorkdays: 19, requiredMinutes: 9120, shortageMinutes: 9120,
        attendanceSummary: {
          monthRequiredMinutes: 14880, requiredMinutesThroughDate: 9600,
          workedMinutes: 0, actualShortageMinutes: 9600, actualOvertimeMinutes: 0,
          absenceDaysWithPermission: 19, absenceDaysWithoutPermission: 0,
          weeklyDayOffDays: 0, asOfDate: '2026-07-20', provisional: false,
        },
      },
    });
    // Viewing payroll must not write attendance records.
    expect(await database.select().from(attendanceDailyRecords)).toHaveLength(0);
  });

  it('includes live attendance in a partial employment month', async () => {
    const { branchId, employeeId } = await createFixtures();
    await database.update(employees).set({ createdAt: new Date('2026-07-20T06:00:00Z') })
      .where(eq(employees.id, employeeId));
    await database.insert(attendanceSessions).values({
      employeeId, branchId, attendanceDate: '2026-07-20', requiredMinutes: 480,
      checkInAt: new Date('2026-07-20T06:00:00Z'), createdAt: fixedNow, updatedAt: fixedNow,
    });
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance: repository() });
    await expect(payroll.service.preview(employeeId, '2026-07')).resolves.toMatchObject({
      attendanceSummary: {
        monthRequiredMinutes: 5760, requiredMinutesThroughDate: 480,
        workedMinutes: 180, actualShortageMinutes: 300, actualOvertimeMinutes: 0,
        absenceDaysWithPermission: 0, absenceDaysWithoutPermission: 0,
        weeklyDayOffDays: 0, asOfDate: '2026-07-20', provisional: true,
      },
    });
  });

  it('caps delayed open sessions at sixteen hours and excludes future weekly days off from days already taken', async () => {
    const { branchId, employeeId } = await createFixtures();
    await database.update(employees).set({ createdAt: new Date('2026-07-19T06:00:00Z') })
      .where(eq(employees.id, employeeId));
    await database.insert(attendanceSessions).values({
      employeeId, branchId, attendanceDate: '2026-07-19', requiredMinutes: 480,
      checkInAt: new Date('2026-07-19T06:00:00Z'), createdAt: fixedNow, updatedAt: fixedNow,
    });
    await database.insert(attendanceDailyRecords).values({
      employeeId, branchId, attendanceDate: '2026-07-25', status: 'weekly_day_off',
      absenceRequiredMinutes: 480, dayOffConvertedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow,
    });
    await expect(database.transaction((transaction) => (
      repository().readPayrollFacts(employeeId, '2026-07', transaction, 'preview')
    ))).resolves.toMatchObject({
      facts: {
        attendanceSummary: {
          monthRequiredMinutes: 5760, requiredMinutesThroughDate: 960,
          workedMinutes: 960, actualShortageMinutes: 0, actualOvertimeMinutes: 0,
          absenceDaysWithPermission: 0, absenceDaysWithoutPermission: 0,
          weeklyDayOffDays: 0, provisional: true,
        },
      },
    });
  });

  it('shows real extra hours without deducting the double-absence penalty from worked time', async () => {
    const { branchId, employeeId } = await createFixtures();
    await database.update(employees).set({ createdAt: new Date('2026-07-20T00:00:00Z') })
      .where(eq(employees.id, employeeId));
    await database.insert(attendanceSessions).values({
      employeeId, branchId, attendanceDate: '2026-07-20', requiredMinutes: 120,
      checkInAt: new Date('2026-07-20T06:00:00Z'), checkOutAt: fixedNow,
      workedMinutes: 180, overtimeMinutes: 60, shortageMinutes: 0,
      createdAt: fixedNow, updatedAt: fixedNow,
    });
    await expect(database.transaction((transaction) => (
      repository().readPayrollFacts(employeeId, '2026-07', transaction, 'preview')
    ))).resolves.toMatchObject({
      facts: { attendanceSummary: { workedMinutes: 180, actualShortageMinutes: 0, actualOvertimeMinutes: 60 } },
    });
  });

  it('persists inferred absences on approval and freezes the attendance summary', async () => {
    const { employeeId } = await createFixtures();
    await database.update(employees).set({ createdAt: new Date('2026-06-29T06:00:00Z') })
      .where(eq(employees.id, employeeId));
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance: repository() });
    const approved = await payroll.service.finalize(employeeId, '2026-06');
    expect(approved).toMatchObject({
      status: 'finalized', eligibleWorkdays: 2, requiredMinutes: 960, shortageMinutes: 960,
      attendanceSummary: {
        monthRequiredMinutes: 960, requiredMinutesThroughDate: 960,
        workedMinutes: 0, absenceDaysWithPermission: 2, absenceDaysWithoutPermission: 0,
        asOfDate: '2026-06-30', provisional: false,
      },
    });
    expect(await database.select().from(attendanceDailyRecords)).toHaveLength(2);
    await database.update(employees).set({ shiftDurationMinutes: 600 }).where(eq(employees.id, employeeId));
    expect(await payroll.service.preview(employeeId, '2026-06')).toEqual(approved);
    // Older approvals retain their monetary snapshot; only their missing summary is reconstructed.
    await database.update(payrollMonths).set({ attendanceSummary: null }).where(eq(payrollMonths.id, approved.id));
    await expect(payroll.service.preview(employeeId, '2026-06')).resolves.toMatchObject({
      netSalary: approved.netSalary,
      attendanceSummary: { monthRequiredMinutes: 960, absenceDaysWithPermission: 2, reconstructed: true },
    });
  });

  it('does not require attendance on a deactivation date after reactivation', async () => {
    const { branchId, employeeId } = await createFixtures();
    await database.insert(employeeEmploymentPeriods).values([
      {
        employeeId,
        activeFrom: new Date('2026-07-17T06:00:00.000Z'),
        activeTo: new Date('2026-07-18T12:00:00.000Z'),
        createdAt: fixedNow,
      },
      {
        employeeId,
        activeFrom: new Date('2026-07-19T06:00:00.000Z'),
        activeTo: null,
        createdAt: fixedNow,
      },
    ]);
    await database.insert(attendanceDailyRecords).values(['2026-07-17', '2026-07-19'].map((attendanceDate) => ({
      employeeId,
      branchId,
      attendanceDate,
      status: 'absence' as const,
      absenceRequiredMinutes: 480,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    })));
    const repo = repository();

    await expect(repo.reconcileMissingDay({
      employeeId, attendanceDate: '2026-07-18', resolution: 'absence',
    })).rejects.toThrow('Attendance day is not missing');
    await expect(database.transaction((transaction) => (
      repo.readPayrollFacts(employeeId, '2026-07', transaction, 'preview')
    ))).resolves.toMatchObject({
      kind: 'ready',
      facts: {
        fullMonthWorkdays: 31,
        eligibleWorkdays: 2,
        requiredMinutes: 960,
        overtimeMinutes: 0,
        shortageMinutes: 960,
      },
    });
  });

  it('keeps provisional previews available while reserving open-session blockers for finalization', async () => {
    const { branchId, employeeId } = await createFixtures();
    await database.update(employees).set({
      createdAt: new Date('2026-06-30T06:00:00.000Z'),
    }).where(eq(employees.id, employeeId));
    await database.insert(attendanceSessions).values({
      employeeId,
      branchId,
      attendanceDate: '2026-06-30',
      requiredMinutes: 480,
      checkInAt: new Date('2026-06-30T07:00:00.000Z'),
      checkOutAt: null,
      workedMinutes: null,
      overtimeMinutes: null,
      shortageMinutes: null,
      automaticTimeoutAt: null,
      automaticTimeoutCorrectedAt: null,
      flagged: false,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });
    const payroll = createPayrollModule(database, { now: () => fixedNow, attendance: repository() });

    await expect(payroll.service.preview(employeeId, '2026-06')).resolves.toMatchObject({
      status: 'open', eligibleWorkdays: 1, requiredMinutes: 480,
      overtimeMinutes: 0, shortageMinutes: 0,
    });
    await expect(payroll.service.finalize(employeeId, '2026-06')).rejects.toMatchObject({
      code: 'PAYROLL_BLOCKED', reasons: ['OPEN_SESSION'],
    });
  });

});
