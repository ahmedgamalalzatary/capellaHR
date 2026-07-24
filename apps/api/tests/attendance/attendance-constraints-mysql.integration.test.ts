import {
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceEvents,
  attendanceSessions,
  employees,
} from '@capella/database/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createFixtures,
  cleanDatabase,
  database,
  fixedNow,
} from './attendance-mysql-fixtures.js';

beforeEach(cleanDatabase);
afterEach(cleanDatabase);

describe('MySQL-backed attendance database constraints', () => {
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

  it('confines the without-permission mark to absences at the database layer', async () => {
    const { branchId, employeeId } = await createFixtures();
    const attendanceDate = '2026-07-19';
    const sessionResult = await database.insert(attendanceSessions).values({
      employeeId, branchId, attendanceDate, requiredMinutes: 480,
      checkInAt: new Date(`${attendanceDate}T06:00:00.000Z`),
      checkOutAt: new Date(`${attendanceDate}T14:00:00.000Z`),
      workedMinutes: 480, overtimeMinutes: 0, shortageMinutes: 0,
      automaticTimeoutAt: null, automaticTimeoutCorrectedAt: null, flagged: false,
      createdAt: fixedNow, updatedAt: fixedNow,
    });
    const record = {
      employeeId, branchId, attendanceDate,
      absenceRequiredMinutes: 480, withoutPermissionAt: fixedNow,
      createdAt: fixedNow, updatedAt: fixedNow,
    };

    await expect(database.insert(attendanceDailyRecords).values({
      ...record, status: 'weekly_day_off' as const, dayOffConvertedAt: fixedNow,
    })).rejects.toMatchObject({ cause: { code: 'ER_CHECK_CONSTRAINT_VIOLATED' } });
    await expect(database.insert(attendanceDailyRecords).values({
      ...record, status: 'attendance_replaced' as const,
      replacedBySessionId: Number(sessionResult[0].insertId), replacedAt: fixedNow,
    })).rejects.toMatchObject({ cause: { code: 'ER_CHECK_CONSTRAINT_VIOLATED' } });
    await expect(database.insert(attendanceDailyRecords).values({
      ...record, status: 'absence' as const,
    })).resolves.toBeDefined();
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

});
