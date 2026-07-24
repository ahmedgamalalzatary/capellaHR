import { createDatabase } from '@capella/database';
import { employeeEmploymentPeriods } from '@capella/database/schema';
import {
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceEvents,
  attendanceJobs,
  attendanceSessions,
  auditEvents,
  authSessions,
  branches,
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
} from '@capella/database/schema';
import { and, asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleAttendanceRepository } from '../../src/modules/attendance/attendance-repository.js';
import { createAttendanceJobProcessor } from '../../src/modules/attendance/attendance-jobs.js';
import { createDrizzleAuthRepositories } from '../../src/modules/auth/auth-repositories.js';
import {
  createDeviceLoginEligibility,
  createDrizzleDeviceRepository,
} from '../../src/modules/devices/devices-repository.js';
import { createPayrollModule } from '../../src/modules/payroll/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const fixedNow = new Date('2026-07-20T09:00:00.000Z');

const createFixtures = async () => {
  const branchResult = await database.insert(branches).values({
    name: 'فرع القاهرة',
    nameNormalized: `attendance-${Date.now()}`,
    location: 'القاهرة',
    latitude: 30.0444,
    longitude: 31.2357,
    gpsAccuracyMeters: 5,
    attendanceRadiusMeters: 150,
    hasEverBeenReferenced: true,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  const branchId = Number(branchResult[0].insertId);
  const employeeResult = await database.insert(employees).values({
    employeeCode: 42,
    fullName: 'موظف الحضور',
    personalPhone: '01000000042',
    whatsappPhone: '01000000042',
    pinHash: 'hash',
    credentialVersion: 3,
    age: 30,
    address: 'القاهرة',
    branchId,
    shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00',
    deletedAt: null,
    createdAt: new Date('2026-07-01T09:00:00.000Z'),
    updatedAt: fixedNow,
  });
  const employeeId = Number(employeeResult[0].insertId);
  await database.insert(employeeBranchAssignments).values({
    employeeId, branchId, effectiveFrom: new Date('2026-07-01T09:00:00.000Z'), createdAt: new Date('2026-07-01T09:00:00.000Z'),
  });
  const deviceResult = await database.insert(devices).values({
    assignmentType: 'employee',
    employeeId,
    branchId: null,
    installationMarkerHash: `${Date.now()}`.padStart(64, '1').slice(0, 64),
    browser: 'Chrome',
    platform: 'Android',
    status: 'active',
    pairedAt: fixedNow,
  });
  return { branchId, employeeId, deviceId: Number(deviceResult[0].insertId) };
};

const cleanDatabase = async () => {
  await database.delete(auditEvents);
  await database.delete(attendanceEvents);
  await database.delete(attendanceDeniedAttempts);
  await database.delete(attendanceDailyRecords);
  await database.delete(attendanceJobs);
  await database.delete(attendanceSessions);
  await database.delete(payrollMonths);
  await database.delete(employeeSalaryPeriods);
  await database.delete(deviceHistory);
  await database.delete(devices);
  await database.delete(devicePairingRequests);
  await database.delete(authSessions);
  await database.delete(employeeImages);
  await database.delete(employeePhoneReservations);
  await database.delete(employeeBranchAssignments);
  await database.delete(employeeEmploymentPeriods);
  await database.delete(employees);
  await database.delete(employeeCodeSequence);
  await database.delete(branches);
};

beforeEach(cleanDatabase);
afterEach(cleanDatabase);

const mutation = (employeeId: number, deviceId: number, occurredAt = fixedNow) => ({
  employeeId,
  expectedCredentialVersion: 3,
  eventType: 'check_in' as const,
  source: 'personal_device' as const,
  deviceId,
  occurredAt,
  latitude: 30.0444,
  longitude: 31.2357,
  gpsAccuracyMeters: 8,
  distanceMeters: 0,
  branchLatitude: 30.0444,
  branchLongitude: 31.2357,
  branchRadiusMeters: 150,
});

const repository = (
  readRequiredDuration: (employeeId: number, context: unknown) => Promise<number> = () => Promise.resolve(480),
) => createDrizzleAttendanceRepository(database, {
  now: () => fixedNow,
  timeZone: 'Africa/Cairo',
  isFinanciallyLocked: () => Promise.resolve(false),
  readRequiredDuration,
});

describe('MySQL-backed attendance', () => {
  it('snapshots the original branch for backdated attendance created after reassignment', async () => {
    const { branchId, employeeId } = await createFixtures();
    const sessionAt = new Date('2026-07-19T06:00:00.000Z');
    const newBranchResult = await database.insert(branches).values({
      name: 'New attendance branch', nameNormalized: `new-attendance-${Date.now()}`,
      location: 'Giza', latitude: 30, longitude: 31, gpsAccuracyMeters: 5,
      attendanceRadiusMeters: 100, hasEverBeenReferenced: true, createdAt: fixedNow, updatedAt: fixedNow,
    });
    const newBranchId = Number(newBranchResult[0].insertId);
    await database.update(employeeBranchAssignments).set({ effectiveTo: fixedNow })
      .where(and(eq(employeeBranchAssignments.employeeId, employeeId), eq(employeeBranchAssignments.branchId, branchId)));
    await database.insert(employeeBranchAssignments).values({ employeeId, branchId: newBranchId, effectiveFrom: fixedNow, createdAt: fixedNow });
    await database.update(employees).set({ branchId: newBranchId, updatedAt: fixedNow }).where(eq(employees.id, employeeId));
    await expect(repository().manualCheckIn({ employeeId, occurredAt: sessionAt }))
      .resolves.toMatchObject({ kind: 'success' });

    const result = await repository().listSessions({ page: 1, pageSize: 20 });
    expect(result.items[0]).toMatchObject({ employeeId, branchId });
    expect((await repository().listSessions({ branchId, page: 1, pageSize: 20 })).total).toBe(1);
    expect((await repository().listSessions({ branchId: newBranchId, page: 1, pageSize: 20 })).total).toBe(0);
  });
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
    ))).resolves.toEqual({
      kind: 'ready',
      facts: {
        fullMonthWorkdays: 27,
        eligibleWorkdays: 25,
        requiredMinutes: 12_000,
        overtimeMinutes: 20,
        shortageMinutes: 10_590,
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

  it('blocks Payroll when an ended eligible attendance date has not been reconciled', async () => {
    const { employeeId } = await createFixtures();
    await database.update(employees).set({
      createdAt: new Date('2026-06-30T21:00:00.000Z'),
    }).where(eq(employees.id, employeeId));
    const repo = repository();

    await expect(database.transaction((transaction) => (
      repo.readPayrollFacts(employeeId, '2026-07', transaction, 'preview')
    ))).resolves.toEqual({
      kind: 'blocked',
      reasons: ['ATTENDANCE_RECONCILIATION_PENDING'],
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

  it('finds the earliest missing durable absence date after worker downtime', async () => {
    await createFixtures();
    const repo = repository();
    await repo.ensureAbsenceJob('2026-07-01', new Date('2026-07-01T21:00:00.000Z'));
    await repo.ensureAbsenceJob('2026-07-03', new Date('2026-07-03T21:00:00.000Z'));

    await expect(repo.findMissingAbsenceScheduleStart('2026-07-03'))
      .resolves.toBe('2026-07-02');
    await repo.ensureAbsenceJob('2026-07-02', new Date('2026-07-02T21:00:00.000Z'));
    await expect(repo.findMissingAbsenceScheduleStart('2026-07-03'))
      .resolves.toBeNull();
  });

  it('initializes a new absence schedule at the rollout date instead of employee history', async () => {
    await createFixtures();
    const repo = repository();

    await expect(repo.findMissingAbsenceScheduleStart('2026-07-20'))
      .resolves.toBe('2026-07-20');
  });

  it('serializes concurrent check-ins into one session for the Cairo date', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const repo = repository();

    const results = await Promise.all([
      repo.checkIn(mutation(employeeId, deviceId)),
      repo.checkIn(mutation(employeeId, deviceId)),
    ]);

    expect(results.filter(({ kind }) => kind === 'success')).toHaveLength(1);
    expect(results.filter(({ kind }) => kind === 'session_exists')).toHaveLength(1);
    expect(await database.select().from(attendanceSessions)).toHaveLength(1);
    expect(await database.select().from(attendanceEvents)).toHaveLength(1);
  });

  it('captures the required duration through the transaction-aware Shifts gateway', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const readRequiredDuration = vi.fn(async () => 360);
    const repo = repository(readRequiredDuration);

    const result = await repo.checkIn(mutation(employeeId, deviceId));

    expect(result).toMatchObject({ kind: 'success', session: { requiredMinutes: 360 } });
    expect(readRequiredDuration).toHaveBeenCalledWith(employeeId, expect.anything(), false);
  });

  it('uses the historical Shift gateway mode for an eligible deletion-date manual event', async () => {
    const { employeeId } = await createFixtures();
    const deletedAt = new Date('2026-07-20T10:00:00.000Z');
    await database.update(employees).set({ deletedAt }).where(eq(employees.id, employeeId));
    const readRequiredDuration = vi.fn(async () => 480);
    const repo = repository(readRequiredDuration);

    await expect(repo.manualCheckIn({
      employeeId,
      occurredAt: new Date('2026-07-20T09:59:59.999Z'),
    })).resolves.toMatchObject({ kind: 'success', session: { requiredMinutes: 480 } });
    expect(readRequiredDuration).toHaveBeenCalledWith(employeeId, expect.anything(), true);
  });

  it('enforces one open session per employee across different dates at the database layer', async () => {
    const { branchId, employeeId } = await createFixtures();
    const base = {
      employeeId,
      branchId,
      requiredMinutes: 480,
      checkOutAt: null,
      workedMinutes: null,
      overtimeMinutes: null,
      shortageMinutes: null,
      automaticTimeoutAt: null,
      automaticTimeoutCorrectedAt: null,
      flagged: false,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    };
    await database.insert(attendanceSessions).values({
      ...base,
      attendanceDate: '2026-07-19',
      checkInAt: new Date('2026-07-19T06:00:00.000Z'),
    });

    await expect(database.insert(attendanceSessions).values({
      ...base,
      attendanceDate: '2026-07-20',
      checkInAt: new Date('2026-07-20T06:00:00.000Z'),
    })).rejects.toMatchObject({ cause: { code: 'ER_DUP_ENTRY' } });
  });

  it('rejects closed sessions whose minute totals do not match their timestamps', async () => {
    const { branchId, employeeId } = await createFixtures();
    const values = {
      employeeId,
      branchId,
      attendanceDate: '2026-07-19',
      requiredMinutes: 480,
      checkInAt: new Date('2026-07-19T06:00:00.000Z'),
      checkOutAt: new Date('2026-07-19T07:00:00.000Z'),
      automaticTimeoutAt: null,
      automaticTimeoutCorrectedAt: null,
      flagged: false,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    };

    await expect(database.insert(attendanceSessions).values({
      ...values,
      workedMinutes: 1,
      overtimeMinutes: 999,
      shortageMinutes: 999,
    })).rejects.toMatchObject({ cause: { code: 'ER_CHECK_CONSTRAINT_VIOLATED' } });
    await expect(database.insert(attendanceSessions).values({
      ...values,
      workedMinutes: null,
      overtimeMinutes: null,
      shortageMinutes: null,
    })).rejects.toMatchObject({ cause: { code: 'ER_CHECK_CONSTRAINT_VIOLATED' } });
  });

  it('rejects inconsistent automatic-timeout state at the database layer', async () => {
    const { branchId, employeeId } = await createFixtures();

    await expect(database.insert(attendanceSessions).values({
      employeeId,
      branchId,
      attendanceDate: '2026-07-19',
      requiredMinutes: 480,
      checkInAt: new Date('2026-07-19T06:00:00.000Z'),
      checkOutAt: new Date('2026-07-19T07:00:00.000Z'),
      workedMinutes: 60,
      overtimeMinutes: 0,
      shortageMinutes: 420,
      automaticTimeoutAt: new Date('2026-07-19T07:00:00.000Z'),
      automaticTimeoutCorrectedAt: null,
      flagged: false,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    })).rejects.toMatchObject({ cause: { code: 'ER_CHECK_CONSTRAINT_VIOLATED' } });
    await expect(database.insert(attendanceSessions).values({
      employeeId,
      branchId,
      attendanceDate: '2026-07-19',
      requiredMinutes: 480,
      checkInAt: new Date('2026-07-19T06:00:00.000Z'),
      checkOutAt: new Date('2026-07-19T07:00:00.000Z'),
      workedMinutes: 60,
      overtimeMinutes: 0,
      shortageMinutes: 420,
      automaticTimeoutAt: null,
      automaticTimeoutCorrectedAt: null,
      flagged: true,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    })).rejects.toMatchObject({ cause: { code: 'ER_CHECK_CONSTRAINT_VIOLATED' } });
  });

  it('rejects cross-owner and cross-date attendance links at the database layer', async () => {
    const { branchId, employeeId } = await createFixtures();
    const secondResult = await database.insert(employees).values({
      employeeCode: 43,
      fullName: 'Second attendance employee',
      personalPhone: '01000000043',
      whatsappPhone: '01000000043',
      pinHash: 'hash',
      credentialVersion: 1,
      age: 31,
      address: 'Cairo',
      branchId,
      shiftDurationMinutes: 480,
      monthlyBaseSalary: '5000.00',
      deletedAt: null,
      createdAt: new Date('2026-07-01T09:00:00.000Z'),
      updatedAt: fixedNow,
    });
    const secondEmployeeId = Number(secondResult[0].insertId);
    const sessionResult = await database.insert(attendanceSessions).values({
      employeeId,
      branchId,
      attendanceDate: '2026-07-19',
      requiredMinutes: 480,
      checkInAt: new Date('2026-07-19T06:00:00.000Z'),
      flagged: false,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });
    const sessionId = Number(sessionResult[0].insertId);
    const foreignKeyFailure = { cause: { code: 'ER_NO_REFERENCED_ROW_2' } };

    await expect(database.insert(attendanceEvents).values({
      sessionId,
      employeeId: secondEmployeeId,
      eventType: 'check_in',
      source: 'admin_manual',
      occurredAt: new Date('2026-07-19T06:00:00.000Z'),
      createdAt: fixedNow,
    })).rejects.toMatchObject(foreignKeyFailure);
    await expect(database.insert(attendanceDailyRecords).values({
      employeeId: secondEmployeeId,
      branchId,
      attendanceDate: '2026-07-19',
      status: 'attendance_replaced',
      absenceRequiredMinutes: 480,
      replacedBySessionId: sessionId,
      replacedAt: fixedNow,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    })).rejects.toMatchObject(foreignKeyFailure);
    await expect(database.insert(attendanceDailyRecords).values({
      employeeId,
      branchId,
      attendanceDate: '2026-07-20',
      status: 'attendance_replaced',
      absenceRequiredMinutes: 480,
      replacedBySessionId: sessionId,
      replacedAt: fixedNow,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    })).rejects.toMatchObject(foreignKeyFailure);
    await expect(database.insert(attendanceDeniedAttempts).values({
      eventType: 'check_in',
      claimedEmployeeCode: 43,
      employeeId: secondEmployeeId,
      source: 'personal_device',
      occurredAt: new Date('2026-07-19T06:00:00.000Z'),
      failureReason: 'DEVICE_INVALID',
      suspicious: true,
      approvedAt: fixedNow,
      approvedSessionId: sessionId,
      createdAt: fixedNow,
    })).rejects.toMatchObject(foreignKeyFailure);

    const otherOwnerAttempt = await database.insert(attendanceDeniedAttempts).values({
      eventType: 'check_in', claimedEmployeeCode: 43, employeeId: secondEmployeeId,
      source: 'personal_device', occurredAt: fixedNow, failureReason: 'DEVICE_INVALID',
      suspicious: true, createdAt: fixedNow,
    });
    const wrongTypeAttempt = await database.insert(attendanceDeniedAttempts).values({
      eventType: 'check_out', claimedEmployeeCode: 42, employeeId,
      source: 'personal_device', occurredAt: fixedNow, failureReason: 'DEVICE_INVALID',
      suspicious: true, createdAt: fixedNow,
    });
    const matchingAttempt = await database.insert(attendanceDeniedAttempts).values({
      eventType: 'check_in', claimedEmployeeCode: 42, employeeId,
      source: 'personal_device', occurredAt: fixedNow, failureReason: 'DEVICE_INVALID',
      suspicious: true, createdAt: fixedNow,
    });
    const approvedEvent = (approvedDeniedAttemptId: number | null) => ({
      sessionId,
      employeeId,
      eventType: 'check_in' as const,
      source: 'admin_approved_denied' as const,
      approvedDeniedAttemptId,
      occurredAt: new Date('2026-07-19T06:00:00.000Z'),
      createdAt: fixedNow,
    });
    await expect(database.insert(attendanceEvents).values(
      approvedEvent(Number(otherOwnerAttempt[0].insertId)),
    )).rejects.toMatchObject(foreignKeyFailure);
    await expect(database.insert(attendanceEvents).values(
      approvedEvent(Number(wrongTypeAttempt[0].insertId)),
    )).rejects.toMatchObject(foreignKeyFailure);
    await expect(database.insert(attendanceEvents).values({
      ...approvedEvent(Number(matchingAttempt[0].insertId)),
      source: 'admin_manual',
    })).rejects.toMatchObject({ cause: { code: 'ER_CHECK_CONSTRAINT_VIOLATED' } });
    await expect(database.insert(attendanceEvents).values(
      approvedEvent(null),
    )).rejects.toMatchObject({ cause: { code: 'ER_CHECK_CONSTRAINT_VIOLATED' } });
  });

  it('closes the open session with whole-minute overtime and immutable event snapshots', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const repo = repository();
    await repo.checkIn(mutation(employeeId, deviceId));
    await database.insert(authSessions).values({
      id: '10000000-0000-4000-8000-000000000001',
      tokenHash: 'a'.repeat(64),
      actorType: 'employee',
      employeeId,
      createdAt: fixedNow,
      revokedAt: null,
    });
    const checkOutAt = new Date(fixedNow.getTime() + 481 * 60_000 + 59_999);

    const result = await repo.checkOut({
      ...mutation(employeeId, deviceId, checkOutAt),
      eventType: 'check_out',
    });

    expect(result).toMatchObject({
      kind: 'success',
      session: { workedMinutes: 481, overtimeMinutes: 1, shortageMinutes: 0 },
    });
    const events = await database.select().from(attendanceEvents).orderBy(asc(attendanceEvents.id));
    expect(events.map(({ eventType, source }) => ({ eventType, source }))).toEqual([
      { eventType: 'check_in', source: 'personal_device' },
      { eventType: 'check_out', source: 'personal_device' },
    ]);
    expect((await database.select().from(authSessions))[0]?.revokedAt).toEqual(fixedNow);
    const attendanceAudit = await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'employee_check_out'));
    expect(attendanceAudit[0]).toMatchObject({
      actorType: 'employee',
      actorIdentifier: String(employeeId),
      relatedIds: expect.objectContaining({
        employeeId: String(employeeId),
        sessionId: expect.any(String),
        eventId: expect.any(String),
        deviceId: String(deviceId),
      }),
      beforeState: expect.objectContaining({
        checkOutAt: null,
        workedMinutes: null,
        overtimeMinutes: null,
        shortageMinutes: null,
        automaticTimeoutAt: null,
        flagged: false,
      }),
    });
  });

  it('cannot leave a new login active when login races with checkout', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const attendance = repository();
    const sessions = createDrizzleAuthRepositories(database, () => fixedNow).sessions;
    await attendance.checkIn(mutation(employeeId, deviceId));

    const [loginResult, checkOutResult] = await Promise.all([
      sessions.createEmployeeIfCurrent({
        id: '20000000-0000-4000-8000-000000000002',
        tokenHash: 'b'.repeat(64),
        actorType: 'employee',
        employeeId,
        revokedAt: null,
      }, 3, () => Promise.resolve(true), (context) => attendance.hasOpenSession(employeeId, context)),
      attendance.checkOut({
        ...mutation(employeeId, deviceId, new Date(fixedNow.getTime() + 60_000)),
        eventType: 'check_out',
      }),
    ]);

    expect(['created', 'attendance_required']).toContain(loginResult);
    expect(checkOutResult.kind).toBe('success');
    expect((await database.select().from(authSessions)).every(({ revokedAt }) => revokedAt !== null)).toBe(true);
  });

  it('rejects session creation when the verified device was revoked before the locked recheck', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const attendance = repository();
    const sessions = createDrizzleAuthRepositories(database, () => fixedNow).sessions;
    const eligibility = createDeviceLoginEligibility();
    await attendance.checkIn(mutation(employeeId, deviceId));
    await createDrizzleDeviceRepository(database, () => fixedNow).revoke(deviceId);

    const result = await sessions.createEmployeeIfCurrent({
      id: '40000000-0000-4000-8000-000000000004',
      tokenHash: 'd'.repeat(64),
      actorType: 'employee',
      employeeId,
      revokedAt: null,
    }, 3, (context) => eligibility.isActiveEmployeeDevice(deviceId, employeeId, context),
    (context) => attendance.hasOpenSession(employeeId, context));

    expect(result).toBe('device_invalid');
    expect(await database.select().from(authSessions)).toHaveLength(0);
  });

  it('replaces an automatic absence with backdated manual attendance but protects a day off', async () => {
    const { branchId, employeeId } = await createFixtures();
    const absenceResult = await database.insert(attendanceDailyRecords).values({
      employeeId,
      branchId,
      attendanceDate: '2026-07-10',
      status: 'absence',
      absenceRequiredMinutes: 480,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });
    await database.insert(attendanceDailyRecords).values({
      employeeId,
      branchId,
      attendanceDate: '2026-07-11',
      status: 'weekly_day_off',
      absenceRequiredMinutes: 480,
      dayOffConvertedAt: fixedNow,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });
    const repo = repository();

    const created = await repo.manualCheckIn({
      employeeId,
      occurredAt: new Date('2026-07-10T07:00:00.000Z'),
    });
    expect(created).toMatchObject({ kind: 'success' });
    expect((await database.select().from(attendanceDailyRecords)
      .where(eq(attendanceDailyRecords.id, Number(absenceResult[0].insertId))))[0])
      .toMatchObject({
        status: 'attendance_replaced',
        replacedBySessionId: expect.any(Number),
        replacedAt: fixedNow,
      });
    const replacementAudit = await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'replace_absence'));
    expect(replacementAudit[0]).toMatchObject({
      beforeState: expect.objectContaining({ status: 'absence' }),
      afterState: expect.objectContaining({ status: 'attendance_replaced' }),
      relatedIds: expect.objectContaining({
        dailyRecordId: String(Number(absenceResult[0].insertId)),
        sessionId: expect.any(String),
      }),
    });
    await expect(repo.manualCheckIn({
      employeeId,
      occurredAt: new Date('2026-07-11T07:00:00.000Z'),
    })).resolves.toEqual({ kind: 'weekly_day_off' });
  });

  it('approves a denied event at its original timestamp and immediately times out an old check-in', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const repo = repository();
    const occurredAt = new Date('2026-07-19T06:00:00.000Z');
    const attempt = await repo.recordDeniedAttempt({
      eventType: 'check_in',
      claimedEmployeeCode: 42,
      employeeId,
      source: 'personal_device',
      deviceId,
      occurredAt,
      latitude: 30.0444,
      longitude: 31.2357,
      gpsAccuracyMeters: 8,
      distanceMeters: 0,
      branchLatitude: 30.0444,
      branchLongitude: 31.2357,
      branchRadiusMeters: 150,
      failureReason: 'DEVICE_INVALID',
      suspicious: true,
    });
    await database.insert(authSessions).values({
      id: '30000000-0000-4000-8000-000000000003',
      tokenHash: 'c'.repeat(64),
      actorType: 'employee',
      employeeId,
      createdAt: fixedNow,
      revokedAt: null,
    });

    const result = await repo.approveDeniedAttempt(attempt.id);

    expect(result).toMatchObject({
      kind: 'success',
      session: {
        checkInAt: occurredAt,
        checkOutAt: new Date(occurredAt.getTime() + 16 * 60 * 60_000),
        workedMinutes: 960,
        flagged: true,
      },
    });
    expect((await database.select().from(attendanceDeniedAttempts)
      .where(eq(attendanceDeniedAttempts.id, attempt.id)))[0])
      .toMatchObject({ approvedAt: fixedNow, approvedSessionId: expect.any(Number) });
    expect((await database.select().from(authSessions))[0]?.revokedAt).toEqual(fixedNow);
    const timeoutAudit = await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'automatic_timeout'));
    expect(timeoutAudit[0]).toMatchObject({
      actorType: 'system',
      actorIdentifier: 'system',
      relatedIds: expect.objectContaining({ sessionId: expect.any(String), eventId: expect.any(String) }),
    });
  });

  it('allows correction only for automatic timeout and preserves its original value', async () => {
    const { employeeId } = await createFixtures();
    const repo = repository();
    const checkInAt = new Date('2026-07-19T06:00:00.000Z');
    const created = await repo.manualCheckIn({ employeeId, occurredAt: checkInAt });
    expect(created.kind).toBe('success');
    if (created.kind !== 'success') return;
    const originalTimeout = new Date(checkInAt.getTime() + 16 * 60 * 60_000);
    const correctedAt = new Date(checkInAt.getTime() + 8 * 60 * 60_000);

    const corrected = await repo.correctAutomaticTimeout(created.session.id, correctedAt);

    expect(corrected).toMatchObject({
      kind: 'success',
      session: {
        checkOutAt: correctedAt,
        automaticTimeoutAt: originalTimeout,
        automaticTimeoutCorrectedAt: fixedNow,
        workedMinutes: 480,
      },
    });
    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'attendance')).orderBy(asc(auditEvents.id));
    expect(events.map(({ action }) => action)).toEqual(expect.arrayContaining([
      'manual_check_in', 'automatic_timeout', 'correct_automatic_timeout',
    ]));
  });

  it('persists the exact timeout schedule atomically and resolves it on ordinary checkout', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const repo = repository();

    const checkedIn = await repo.checkIn(mutation(employeeId, deviceId));

    expect(checkedIn.kind).toBe('success');
    const scheduled = (await database.select().from(attendanceJobs))[0];
    expect(scheduled).toMatchObject({
      jobType: 'automatic_timeout',
      status: 'scheduled',
      runAt: new Date(fixedNow.getTime() + 16 * 60 * 60_000),
      attemptCount: 0,
    });

    await repo.manualCheckOut({
      employeeId,
      occurredAt: new Date(fixedNow.getTime() + 60 * 60_000),
    });

    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'completed', completedAt: fixedNow });
    expect((await database.select().from(auditEvents)
      .where(eq(auditEvents.entityType, 'attendance_job'))).map(({ action }) => action))
      .toEqual(expect.arrayContaining(['job_schedule', 'job_cancel_timeout']));
  });

  it('enforces the exact timeout when checkout arrives after a delayed worker deadline', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const apiRepository = repository();
    const checkedIn = await apiRepository.checkIn(mutation(employeeId, deviceId));
    expect(checkedIn.kind).toBe('success');
    if (checkedIn.kind !== 'success') return;
    const timeoutAt = new Date(fixedNow.getTime() + 16 * 60 * 60_000);
    const delayedNow = new Date(timeoutAt.getTime() + 60_000);
    const delayedRepository = createDrizzleAttendanceRepository(database, {
      now: () => delayedNow,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: () => Promise.resolve(480),
    });

    await expect(delayedRepository.manualCheckOut({
      employeeId,
      occurredAt: delayedNow,
    })).resolves.toMatchObject({
      kind: 'success',
      session: {
        checkOutAt: timeoutAt,
        automaticTimeoutAt: timeoutAt,
        workedMinutes: 960,
        flagged: true,
      },
    });
    expect((await database.select().from(attendanceEvents)
      .orderBy(asc(attendanceEvents.id))).at(-1)).toMatchObject({
      eventType: 'check_out',
      source: 'automatic_timeout',
      occurredAt: timeoutAt,
    });
  });

  it('does not treat an overdue unprocessed session as active attendance', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const checkedIn = await repository().checkIn(mutation(employeeId, deviceId));
    expect(checkedIn.kind).toBe('success');
    const overdueRepository = createDrizzleAttendanceRepository(database, {
      now: () => new Date(fixedNow.getTime() + 16 * 60 * 60_000),
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: () => Promise.resolve(480),
    });

    await expect(overdueRepository.hasOpenSession(employeeId)).resolves.toBe(false);
    await expect(overdueRepository.hasAnyOpenSession(employeeId)).resolves.toBe(true);
  });

  it('executes a due timeout at check-in plus exactly 16 hours and remains idempotent', async () => {
    const { employeeId, deviceId } = await createFixtures();
    const apiRepository = repository();
    const checkedIn = await apiRepository.checkIn(mutation(employeeId, deviceId));
    expect(checkedIn.kind).toBe('success');
    if (checkedIn.kind !== 'success') return;
    await database.insert(authSessions).values({
      id: '30000000-0000-4000-8000-000000000004',
      tokenHash: 'd'.repeat(64),
      actorType: 'employee',
      employeeId,
      createdAt: fixedNow,
      revokedAt: null,
    });
    const timeoutAt = new Date(fixedNow.getTime() + 16 * 60 * 60_000);
    const workerRepository = createDrizzleAttendanceRepository(database, {
      now: () => timeoutAt,
      timeZone: 'Africa/Cairo',
      isFinanciallyLocked: () => Promise.resolve(false),
      readRequiredDuration: () => Promise.resolve(480),
    });
    const processor = createAttendanceJobProcessor(workerRepository);

    await expect(processor.processNext()).resolves.toMatchObject({
      jobType: 'automatic_timeout',
      sessionId: checkedIn.session.id,
    });
    await expect(workerRepository.processAutomaticTimeout(checkedIn.session.id)).resolves.toBeUndefined();

    expect((await database.select().from(attendanceSessions))[0]).toMatchObject({
      checkOutAt: timeoutAt,
      automaticTimeoutAt: timeoutAt,
      workedMinutes: 960,
      flagged: true,
    });
    expect((await database.select().from(attendanceEvents))).toHaveLength(2);
    expect((await database.select().from(authSessions))[0]?.revokedAt).toEqual(timeoutAt);
    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'completed', completedAt: timeoutAt, attemptCount: 1 });
    expect((await database.select().from(auditEvents)
      .where(eq(auditEvents.entityType, 'attendance_job'))).map(({ action }) => action))
      .toEqual(expect.arrayContaining(['job_schedule', 'job_claim', 'job_complete']));
  });

  it('includes activation and deactivation dates when generating absences and remains idempotent', async () => {
    const { branchId, employeeId } = await createFixtures();
    await database.insert(employees).values([
      {
        employeeCode: 43,
        fullName: 'موظف تم إنشاؤه في اليوم',
        personalPhone: '01000000043',
        whatsappPhone: '01000000043',
        pinHash: 'hash', credentialVersion: 1, age: 30, address: 'القاهرة', branchId,
        shiftDurationMinutes: 420, monthlyBaseSalary: '5000.00', deletedAt: null,
        createdAt: new Date('2026-07-19T08:00:00.000Z'), updatedAt: fixedNow,
      },
      {
        employeeCode: 44,
        fullName: 'موظف تم حذفه في اليوم',
        personalPhone: '01000000044',
        whatsappPhone: '01000000044',
        pinHash: 'hash', credentialVersion: 1, age: 30, address: 'القاهرة', branchId,
        shiftDurationMinutes: 360, monthlyBaseSalary: '5000.00',
        deletedAt: new Date('2026-07-19T08:00:00.000Z'),
        createdAt: new Date('2026-07-01T08:00:00.000Z'), updatedAt: fixedNow,
      },
    ]);
    const repo = repository();

    await expect(repo.generateAbsences('2026-07-19')).resolves.toBe(2);
    await expect(repo.generateAbsences('2026-07-19')).resolves.toBe(0);

    expect(await database.select().from(attendanceDailyRecords)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        employeeId,
        attendanceDate: '2026-07-19',
        status: 'absence',
        absenceRequiredMinutes: 480,
      }),
      expect.objectContaining({
        attendanceDate: '2026-07-19',
        status: 'absence',
      }),
    ]));
    expect((await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'automatic_absence')))[0]).toMatchObject({
      actorType: 'system',
      actorIdentifier: 'system',
      relatedIds: expect.objectContaining({ employeeId: String(employeeId) }),
    });
  });

  it('marks a job failed after three attempts and makes it eligible for reconciliation', async () => {
    await createFixtures();
    const repo = repository();
    await repo.ensureAbsenceJob('2026-07-19', new Date('2026-07-19T21:00:00.000Z'));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimed = await repo.claimNext();
      expect(claimed?.attemptCount).toBe(attempt + 1);
      await repo.fail(claimed!.id, 'ABSENCE_GENERATION_FAILED');
    }

    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'failed', attemptCount: 3, lastError: 'ABSENCE_GENERATION_FAILED' });
    await repo.reconcileFailed();
    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'scheduled', attemptCount: 3, runAt: fixedNow });
    const jobAudits = await database.select().from(auditEvents)
      .where(eq(auditEvents.entityType, 'attendance_job')).orderBy(asc(auditEvents.id));
    expect(jobAudits.map(({ action }) => action)).toEqual(expect.arrayContaining([
      'job_schedule', 'job_claim', 'job_retry', 'job_failed', 'job_reconcile',
    ]));
    expect(jobAudits.filter(({ action }) => action === 'job_retry'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ afterState: expect.objectContaining({ startedAt: null }) }),
      ]));
  });

  it('audits stale-job recovery using the exact persisted post-recovery state', async () => {
    await createFixtures();
    const repo = repository();
    await repo.ensureAbsenceJob('2026-07-19', new Date('2026-07-19T21:00:00.000Z'));
    await repo.claimNext();

    await expect(repo.recoverStale(fixedNow)).resolves.toBe(1);

    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'scheduled', startedAt: null, lastError: 'WORKER_INTERRUPTED' });
    expect((await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'job_recover')))[0]).toMatchObject({
      beforeState: expect.objectContaining({ status: 'processing', startedAt: fixedNow.toISOString() }),
      afterState: expect.objectContaining({ status: 'scheduled', startedAt: null }),
    });
  });

  it('atomically claims a due attendance job only once across concurrent workers', async () => {
    await createFixtures();
    const repo = repository();
    await repo.ensureAbsenceJob('2026-07-19', new Date('2026-07-19T21:00:00.000Z'));

    const claims = await Promise.all([repo.claimNext(), repo.claimNext()]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await database.select().from(attendanceJobs))[0])
      .toMatchObject({ status: 'processing', attemptCount: 1 });
  });

  it('schedules one absence job and one audit across concurrent worker startups', async () => {
    await createFixtures();
    const repo = repository();
    const runAt = new Date('2026-07-19T21:00:00.000Z');

    await expect(Promise.all([
      repo.ensureAbsenceJob('2026-07-19', runAt),
      repo.ensureAbsenceJob('2026-07-19', runAt),
    ])).resolves.toHaveLength(2);

    expect(await database.select().from(attendanceJobs)).toHaveLength(1);
    expect(await database.select().from(auditEvents)
      .where(eq(auditEvents.action, 'job_schedule'))).toHaveLength(1);
  });

  it('serializes automatic absence generation against a concurrent backdated check-in', async () => {
    const { employeeId } = await createFixtures();
    const repo = repository();
    const attendanceAt = new Date('2026-07-19T08:00:00.000Z');

    await Promise.all([
      repo.generateAbsences('2026-07-19'),
      repo.manualCheckIn({ employeeId, occurredAt: attendanceAt }),
    ]);

    expect(await database.select().from(attendanceSessions)).toHaveLength(1);
    const daily = await database.select().from(attendanceDailyRecords);
    expect(
      daily.length === 0 || (
        daily.length === 1
        && daily[0]?.status === 'attendance_replaced'
        && daily[0]?.replacedBySessionId !== null
      ),
    ).toBe(true);
  });
});
