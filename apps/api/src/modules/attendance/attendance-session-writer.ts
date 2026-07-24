import {
  attendanceDailyRecords,
  attendanceJobs,
  attendanceSessions,
  devices,
  employeeEmploymentPeriods,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import { employmentDateIsActive } from '../employees/employment-period.js';
import { calendarDateInTimeZone } from '../weekly-day-off/index.js';
import { endOfDate } from './attendance-calendar.js';
import {
  actorFor,
  attendanceRelatedIds,
  branchAt,
  findJob,
  findSession,
  lockEmployee,
  writeJobAudit,
  type AttendanceFinancialLockCheck,
  type AttendanceRequiredDurationReader,
  type EventSnapshot,
  type Transaction,
} from './attendance-repository-support.js';
import { createAttendanceSessionCloser } from './attendance-session-close.js';
import {
  calculateDistanceMeters,
  type AttendanceMutationResult,
  type EmployeeAttendanceMutation,
} from './attendance-service.js';

export type AttendanceSessionWriter = ReturnType<typeof createAttendanceSessionWriter>;

export const createAttendanceSessionWriter = (options: {
  now: () => Date;
  timeZone: string;
  isFinanciallyLocked: AttendanceFinancialLockCheck;
  readRequiredDuration: AttendanceRequiredDurationReader;
}) => {
  const { now, timeZone, isFinanciallyLocked, readRequiredDuration } = options;
  const { insertEvent, closeSession } = createAttendanceSessionCloser({ now, isFinanciallyLocked });

  const readEmploymentPeriods = async (
    transaction: Transaction,
    employee: { id: number; createdAt: Date; deletedAt: Date | null },
  ) => {
    const stored = await transaction.select({
      activeFrom: employeeEmploymentPeriods.activeFrom,
      activeTo: employeeEmploymentPeriods.activeTo,
    }).from(employeeEmploymentPeriods).where(eq(employeeEmploymentPeriods.employeeId, employee.id));
    return stored.length ? stored : [{ activeFrom: employee.createdAt, activeTo: employee.deletedAt }];
  };

  const createCheckIn = async (
    transaction: Transaction,
    input: {
      employeeId: number;
      occurredAt: Date;
      expectedCredentialVersion?: number;
      verifiedDevice?: { id: number; assignmentType: 'employee' | 'branch'; assignmentId: number };
      snapshot: EventSnapshot;
    },
  ): Promise<AttendanceMutationResult> => {
    const employee = await lockEmployee(transaction, input.employeeId);
    if (!employee) return { kind: 'employee_not_found' };
    if (employee.employmentStatus === 'inactive') return { kind: 'employment_inactive' };
    if (input.expectedCredentialVersion !== undefined && (
      employee.deletedAt !== null
      || employee.credentialVersion !== input.expectedCredentialVersion
    )) return { kind: 'credentials_changed' };
    if (input.occurredAt.getTime() < employee.createdAt.getTime()
      || (employee.deletedAt && input.occurredAt.getTime() > employee.deletedAt.getTime())) {
      return { kind: 'invalid_time' };
    }
    if (input.verifiedDevice) {
      const assignmentFilter = input.verifiedDevice.assignmentType === 'employee'
        ? and(
          eq(devices.assignmentType, 'employee'),
          eq(devices.employeeId, input.verifiedDevice.assignmentId),
        )
        : and(
          eq(devices.assignmentType, 'branch'),
          eq(devices.branchId, input.verifiedDevice.assignmentId),
        );
      const device = (await transaction.select({ id: devices.id }).from(devices)
        .where(and(
          eq(devices.id, input.verifiedDevice.id),
          eq(devices.status, 'active'),
          assignmentFilter,
        )).for('update').limit(1))[0];
      if (!device) return { kind: 'device_invalid' };
      const lockedDistance = calculateDistanceMeters(
        input.snapshot.latitude!,
        input.snapshot.longitude!,
        employee.branchLatitude,
        employee.branchLongitude,
      );
      if (!Number.isFinite(lockedDistance) || lockedDistance > employee.branchRadiusMeters) return { kind: 'out_of_range' };
      input.snapshot.distanceMeters = lockedDistance;
      input.snapshot.branchLatitude = employee.branchLatitude;
      input.snapshot.branchLongitude = employee.branchLongitude;
      input.snapshot.branchRadiusMeters = employee.branchRadiusMeters;
    }

    const attendanceDate = calendarDateInTimeZone(input.occurredAt, timeZone);
    // A rehired employee is active today but must not gain sessions inside the gap.
    if (!employmentDateIsActive(
      attendanceDate,
      await readEmploymentPeriods(transaction, employee),
      timeZone,
    )) return { kind: 'employment_inactive' };
    if (await isFinanciallyLocked(employee.id, attendanceDate, transaction)) {
      return { kind: 'financially_locked' };
    }
    const daily = (await transaction.select({
      id: attendanceDailyRecords.id,
      status: attendanceDailyRecords.status,
      attendanceDate: attendanceDailyRecords.attendanceDate,
      absenceRequiredMinutes: attendanceDailyRecords.absenceRequiredMinutes,
      withoutPermissionAt: attendanceDailyRecords.withoutPermissionAt,
      dayOffConvertedAt: attendanceDailyRecords.dayOffConvertedAt,
      replacedBySessionId: attendanceDailyRecords.replacedBySessionId,
      replacedAt: attendanceDailyRecords.replacedAt,
      createdAt: attendanceDailyRecords.createdAt,
      updatedAt: attendanceDailyRecords.updatedAt,
    }).from(attendanceDailyRecords).where(and(
      eq(attendanceDailyRecords.employeeId, employee.id),
      eq(attendanceDailyRecords.attendanceDate, attendanceDate),
    )).for('update').limit(1))[0];
    if (daily?.status === 'weekly_day_off') return { kind: 'weekly_day_off' };

    const sameDate = (await transaction.select({ id: attendanceSessions.id })
      .from(attendanceSessions).where(and(
        eq(attendanceSessions.employeeId, employee.id),
        eq(attendanceSessions.attendanceDate, attendanceDate),
      )).for('update').limit(1))[0];
    if (sameDate) return { kind: 'session_exists' };
    const open = (await transaction.select({ id: attendanceSessions.id })
      .from(attendanceSessions).where(eq(attendanceSessions.openEmployeeId, employee.id))
      .for('update').limit(1))[0];
    if (open) return { kind: 'open_session_exists' };

    const createdAt = now();
    const requiredMinutes = daily?.status === 'absence'
      ? daily.absenceRequiredMinutes
      : await readRequiredDuration(employee.id, transaction, employee.deletedAt !== null);
    const inserted = await transaction.insert(attendanceSessions).values({
      employeeId: employee.id,
      branchId: await branchAt(transaction, employee.id, input.occurredAt, employee.branchId),
      attendanceDate,
      requiredMinutes,
      checkInAt: input.occurredAt,
      checkOutAt: null,
      workedMinutes: null,
      overtimeMinutes: null,
      shortageMinutes: null,
      automaticTimeoutAt: null,
      automaticTimeoutCorrectedAt: null,
      flagged: false,
      createdAt,
      updatedAt: createdAt,
    });
    const sessionId = Number(inserted[0].insertId);
    const eventId = await insertEvent(transaction, {
      ...input.snapshot,
      sessionId,
      employeeId: employee.id,
      eventType: 'check_in',
      occurredAt: input.occurredAt,
    });
    if (daily?.status === 'absence') {
      await transaction.update(attendanceDailyRecords).set({
        status: 'attendance_replaced',
        // The day is attended, so an unpermitted-absence mark no longer applies.
        withoutPermissionAt: null,
        replacedBySessionId: sessionId,
        replacedAt: createdAt,
        updatedAt: createdAt,
      }).where(and(
        eq(attendanceDailyRecords.id, daily.id),
        eq(attendanceDailyRecords.status, 'absence'),
      ));
      const replacementActor = actorFor(input.snapshot.source, employee.id);
      await writeAudit(transaction, {
        ...(replacementActor ? { actor: replacementActor } : {}),
        module: 'attendance',
        action: 'replace_absence',
        entityType: 'attendance_daily_record',
        entityId: daily.id,
        beforeState: daily,
        afterState: {
          ...daily,
          status: 'attendance_replaced',
          withoutPermissionAt: null,
          replacedBySessionId: sessionId,
          replacedAt: createdAt,
          updatedAt: createdAt,
        },
        relatedIds: { employeeId: employee.id, sessionId, eventId, dailyRecordId: daily.id },
        createdAt,
      });
    }
    let created = await findSession(transaction, sessionId);
    if (!created) throw new Error('Attendance session disappeared during check-in');
    const auditActor = actorFor(input.snapshot.source, employee.id);
    await writeAudit(transaction, {
      ...(auditActor ? { actor: auditActor } : {}),
      module: 'attendance',
      action: input.snapshot.source === 'admin_manual'
        ? 'manual_check_in' : input.snapshot.source === 'admin_approved_denied'
          ? 'approve_denied_check_in' : 'employee_check_in',
      entityType: 'attendance_session',
      entityId: sessionId,
      afterState: created,
      relatedIds: attendanceRelatedIds(employee.id, sessionId, eventId, input.snapshot.deviceId),
      createdAt,
    });

    const timeoutAt = new Date(input.occurredAt.getTime() + 16 * 60 * 60_000);
    if (timeoutAt.getTime() <= now().getTime()) {
      const timeout = await closeSession(transaction, created, timeoutAt, {
        source: 'automatic_timeout',
        deviceId: null,
        latitude: null,
        longitude: null,
        gpsAccuracyMeters: null,
        distanceMeters: null,
        branchLatitude: input.snapshot.branchLatitude,
        branchLongitude: input.snapshot.branchLongitude,
        branchRadiusMeters: input.snapshot.branchRadiusMeters,
        approvedDeniedAttemptId: null,
      }, true);
      if (timeout.kind !== 'success') return timeout;
      created = timeout.session;
    } else {
      const scheduledJobResult = await transaction.insert(attendanceJobs).values({
        jobType: 'automatic_timeout',
        sessionId,
        attendanceDate: null,
        status: 'scheduled',
        runAt: timeoutAt,
        attemptCount: 0,
        lastError: null,
        startedAt: null,
        completedAt: null,
        createdAt,
        updatedAt: createdAt,
      });
      const scheduledJob = await findJob(transaction, Number(scheduledJobResult[0].insertId));
      if (!scheduledJob) throw new Error('Scheduled attendance job disappeared');
      await writeJobAudit(transaction, 'job_schedule', null, scheduledJob, createdAt);
    }
    return { kind: 'success', session: created };
  };

  const employeeMutationSnapshot = async (
    transaction: Transaction,
    input: EmployeeAttendanceMutation,
  ) => {
    const employee = await lockEmployee(transaction, input.employeeId);
    if (!employee || employee.deletedAt || employee.credentialVersion !== input.expectedCredentialVersion
      || (input.eventType === 'check_in' && employee.employmentStatus === 'inactive')) {
      return { failure: { kind: 'credentials_changed' } as const };
    }
    const assignmentType = input.source === 'personal_device' ? 'employee' as const : 'branch' as const;
    const assignmentId = assignmentType === 'employee' ? employee.id : employee.branchId;
    const device = (await transaction.select({ id: devices.id }).from(devices).where(and(
      eq(devices.id, input.deviceId),
      eq(devices.status, 'active'),
      eq(devices.assignmentType, assignmentType),
      assignmentType === 'employee'
        ? eq(devices.employeeId, assignmentId)
        : eq(devices.branchId, assignmentId),
    )).for('update').limit(1))[0];
    if (!device) return { failure: { kind: 'device_invalid' } as const };
    const distanceMeters = calculateDistanceMeters(
      input.latitude,
      input.longitude,
      employee.branchLatitude,
      employee.branchLongitude,
    );
    if (!Number.isFinite(distanceMeters) || distanceMeters > employee.branchRadiusMeters) {
      return {
        failure: {
          kind: 'out_of_range',
          evaluation: {
            distanceMeters,
            branchLatitude: employee.branchLatitude,
            branchLongitude: employee.branchLongitude,
            branchRadiusMeters: employee.branchRadiusMeters,
          },
        } as const,
      };
    }
    return {
      employee,
      snapshot: {
        source: input.source,
        deviceId: input.deviceId,
        latitude: input.latitude,
        longitude: input.longitude,
        gpsAccuracyMeters: input.gpsAccuracyMeters,
        distanceMeters,
        branchLatitude: employee.branchLatitude,
        branchLongitude: employee.branchLongitude,
        branchRadiusMeters: employee.branchRadiusMeters,
        approvedDeniedAttemptId: null,
      } satisfies EventSnapshot,
    };
  };

  const createAbsenceForEmployee = async (
    transaction: Transaction,
    employeeId: number,
    attendanceDate: string,
    requiredMinutesOverride?: number,
  ) => {
    const employee = await lockEmployee(transaction, employeeId);
    if (!employee) return 0;
    const employmentPeriods = await readEmploymentPeriods(transaction, employee);
    if (!employmentDateIsActive(attendanceDate, employmentPeriods, timeZone)) return 0;
    const existingSession = (await transaction.select({ id: attendanceSessions.id })
      .from(attendanceSessions).where(and(
        eq(attendanceSessions.employeeId, employee.id),
        eq(attendanceSessions.attendanceDate, attendanceDate),
      )).limit(1))[0];
    if (existingSession) return 0;
    const existingRecord = (await transaction.select({ id: attendanceDailyRecords.id })
      .from(attendanceDailyRecords).where(and(
        eq(attendanceDailyRecords.employeeId, employee.id),
        eq(attendanceDailyRecords.attendanceDate, attendanceDate),
      )).limit(1))[0];
    if (existingRecord) return 0;
    if (await isFinanciallyLocked(employee.id, attendanceDate, transaction)) {
      throw new Error('Absence generation is financially locked');
    }
    const requiredMinutes = requiredMinutesOverride ?? await readRequiredDuration(
      employee.id,
      transaction,
      employee.deletedAt !== null,
    );
    const createdAt = now();
    const inserted = await transaction.insert(attendanceDailyRecords).values({
      employeeId: employee.id,
      branchId: await branchAt(transaction, employee.id, endOfDate(attendanceDate, timeZone), employee.branchId),
      attendanceDate,
      status: 'absence',
      absenceRequiredMinutes: requiredMinutes,
      dayOffConvertedAt: null,
      replacedBySessionId: null,
      replacedAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    const id = Number(inserted[0].insertId);
    await writeAudit(transaction, {
      actor: { type: 'system', identifier: 'system' },
      module: 'attendance',
      action: 'automatic_absence',
      entityType: 'attendance_daily_record',
      entityId: id,
      afterState: {
        id,
        employeeId: employee.id,
        attendanceDate,
        status: 'absence',
        absenceRequiredMinutes: requiredMinutes,
        createdAt,
      },
      relatedIds: { employeeId: employee.id, dailyRecordId: id },
      createdAt,
    });
    return 1;
  };

  return { closeSession, createCheckIn, employeeMutationSnapshot, createAbsenceForEmployee };
};
