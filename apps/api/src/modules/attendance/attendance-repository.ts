import type { createDatabase } from '@capella/database';
import {
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceEvents,
  attendanceJobs,
  attendanceSessions,
  authSessions,
  branches,
  devices,
  employeeBranchAssignments,
  employeeImages,
  employees,
} from '@capella/database/schema';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import { branchIdAt } from '../../shared/database/branch-id-at.js';
import type { PayrollAttendanceGateway } from '../payroll/index.js';
import { calendarDateInTimeZone } from '../weekly-day-off/index.js';
import {
  calculateAttendanceMinutes,
  calculateDistanceMeters,
  type AttendanceDeniedAttempt,
  type AttendanceMutationResult,
  type AttendanceRepository,
  type AttendanceSession,
  type EmployeeAttendanceMutation,
} from './attendance-service.js';
import type { AttendanceJob, AttendanceJobRepository } from './attendance-jobs.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

export type AttendanceFinancialLockCheck = (
  employeeId: number,
  attendanceDate: string,
  context: Transaction,
) => Promise<boolean>;

export type AttendanceRequiredDurationReader = (
  employeeId: number,
  context: Transaction,
  includeDeleted: boolean,
) => Promise<number>;

export type AttendanceShiftChangeReconciler = (
  employeeId: number,
  previousRequiredMinutes: number,
  context: Transaction,
) => Promise<number>;

const sessionAssignment = branchIdAt(
  employeeBranchAssignments, attendanceSessions.employeeId, attendanceSessions.checkInAt,
);
const sessionBranchId = sql<number>`coalesce(${attendanceSessions.branchId}, ${sessionAssignment.branchId})`;
const sessionBranchAssignment = sessionAssignment.assignment;
const branchAt = async (
  executor: Executor,
  employeeId: number,
  instant: Date,
  fallbackBranchId: number,
) => (await executor.select({ branchId: employeeBranchAssignments.branchId })
  .from(employeeBranchAssignments).where(and(
    eq(employeeBranchAssignments.employeeId, employeeId),
    lte(employeeBranchAssignments.effectiveFrom, instant),
    or(isNull(employeeBranchAssignments.effectiveTo), gt(employeeBranchAssignments.effectiveTo, instant)),
  )).orderBy(desc(employeeBranchAssignments.effectiveFrom)).limit(1))[0]?.branchId ?? fallbackBranchId;
const sessionFields = {
  id: attendanceSessions.id,
  employeeId: attendanceSessions.employeeId,
  employeeCode: employees.employeeCode,
  employeeName: employees.fullName,
  branchId: sessionBranchId,
  branchName: branches.name,
  attendanceDate: attendanceSessions.attendanceDate,
  requiredMinutes: attendanceSessions.requiredMinutes,
  checkInAt: attendanceSessions.checkInAt,
  checkOutAt: attendanceSessions.checkOutAt,
  workedMinutes: attendanceSessions.workedMinutes,
  overtimeMinutes: attendanceSessions.overtimeMinutes,
  shortageMinutes: attendanceSessions.shortageMinutes,
  automaticTimeoutAt: attendanceSessions.automaticTimeoutAt,
  automaticTimeoutCorrectedAt: attendanceSessions.automaticTimeoutCorrectedAt,
  flagged: attendanceSessions.flagged,
  createdAt: attendanceSessions.createdAt,
  updatedAt: attendanceSessions.updatedAt,
};

const deniedFields = {
  id: attendanceDeniedAttempts.id,
  eventType: attendanceDeniedAttempts.eventType,
  claimedEmployeeCode: attendanceDeniedAttempts.claimedEmployeeCode,
  employeeId: attendanceDeniedAttempts.employeeId,
  source: attendanceDeniedAttempts.source,
  deviceId: attendanceDeniedAttempts.deviceId,
  occurredAt: attendanceDeniedAttempts.occurredAt,
  latitude: attendanceDeniedAttempts.latitude,
  longitude: attendanceDeniedAttempts.longitude,
  gpsAccuracyMeters: attendanceDeniedAttempts.gpsAccuracyMeters,
  distanceMeters: attendanceDeniedAttempts.distanceMeters,
  branchLatitude: attendanceDeniedAttempts.branchLatitude,
  branchLongitude: attendanceDeniedAttempts.branchLongitude,
  branchRadiusMeters: attendanceDeniedAttempts.branchRadiusMeters,
  failureReason: attendanceDeniedAttempts.failureReason,
  suspicious: attendanceDeniedAttempts.suspicious,
  approvedAt: attendanceDeniedAttempts.approvedAt,
  approvedSessionId: attendanceDeniedAttempts.approvedSessionId,
  dismissedAt: attendanceDeniedAttempts.dismissedAt,
  createdAt: attendanceDeniedAttempts.createdAt,
};

const findSession = async (executor: Executor, id: number): Promise<AttendanceSession | null> => (
  await executor.select(sessionFields)
    .from(attendanceSessions)
    .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
    .leftJoin(employeeBranchAssignments, sessionBranchAssignment)
    .innerJoin(branches, eq(branches.id, sessionBranchId))
    .where(eq(attendanceSessions.id, id))
    .limit(1)
)[0] ?? null;

const findDenied = async (
  executor: Executor,
  id: number,
): Promise<AttendanceDeniedAttempt | null> => (
  await executor.select(deniedFields).from(attendanceDeniedAttempts)
    .where(eq(attendanceDeniedAttempts.id, id)).limit(1)
)[0] ?? null;

const findJob = async (executor: Executor, id: number): Promise<AttendanceJob | null> => (
  await executor.select().from(attendanceJobs).where(eq(attendanceJobs.id, id)).limit(1)
)[0] ?? null;

const writeJobAudit = async (
  transaction: Transaction,
  action: string,
  before: AttendanceJob | null,
  after: AttendanceJob,
  createdAt: Date,
) => writeAudit(transaction, {
  actor: { type: 'system', identifier: 'system' },
  module: 'attendance',
  action,
  entityType: 'attendance_job',
  entityId: after.id,
  ...(before === null ? {} : { beforeState: before }),
  afterState: after,
  relatedIds: {
    ...(after.sessionId === null ? {} : { sessionId: after.sessionId }),
  },
  createdAt,
});

const employeeLockFields = {
  id: employees.id,
  employeeCode: employees.employeeCode,
  credentialVersion: employees.credentialVersion,
  deletedAt: employees.deletedAt,
  createdAt: employees.createdAt,
  branchId: employees.branchId,
  branchLatitude: branches.latitude,
  branchLongitude: branches.longitude,
  branchRadiusMeters: branches.attendanceRadiusMeters,
};

const lockEmployee = async (transaction: Transaction, employeeId: number) => (
  await transaction.select(employeeLockFields).from(employees)
    .innerJoin(branches, eq(branches.id, employees.branchId))
    .where(eq(employees.id, employeeId)).for('update').limit(1)
)[0];

const dateAt = (instant: Date, formatter: Intl.DateTimeFormat) => {
  const parts = Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const startOfDate = (value: string, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(year, month - 1, day);
  let low = target - 36 * 60 * 60_000;
  let high = target + 36 * 60 * 60_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateAt(new Date(middle), formatter) < value) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
};

const endOfDate = (value: string, timeZone: string) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return new Date(startOfDate(next, timeZone).valueOf() - 1);
};

const nextCalendarDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

type EventSnapshot = {
  source: 'personal_device' | 'branch_device' | 'admin_manual' | 'admin_approved_denied' | 'automatic_timeout';
  deviceId: number | null;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracyMeters: number | null;
  distanceMeters: number | null;
  branchLatitude: number;
  branchLongitude: number;
  branchRadiusMeters: number;
  approvedDeniedAttemptId: number | null;
};

export const createDrizzleAttendanceRepository = (
  database: Database,
  options: {
    now?: () => Date;
    timeZone?: string;
    isFinanciallyLocked: AttendanceFinancialLockCheck;
    readRequiredDuration: AttendanceRequiredDurationReader;
  },
): AttendanceRepository & AttendanceJobRepository & {
  reconcileDueAbsencesForEmployee: AttendanceShiftChangeReconciler;
} & PayrollAttendanceGateway => {
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone ?? 'Africa/Cairo';
  const { isFinanciallyLocked, readRequiredDuration } = options;
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(0));

  const insertEvent = async (
    transaction: Transaction,
    input: EventSnapshot & {
      sessionId: number;
      employeeId: number;
      eventType: 'check_in' | 'check_out';
      occurredAt: Date;
      source: EventSnapshot['source'] | 'automatic_timeout';
    },
  ) => {
    const inserted = await transaction.insert(attendanceEvents).values({ ...input, createdAt: now() });
    return Number(inserted[0].insertId);
  };

  const actorFor = (source: EventSnapshot['source'], employeeId: number) => (
    source === 'automatic_timeout'
      ? { type: 'system' as const, identifier: 'system' }
      : source === 'personal_device' || source === 'branch_device'
        ? { type: 'employee' as const, identifier: String(employeeId) }
        : undefined
  );

  const attendanceRelatedIds = (
    employeeId: number,
    sessionId: number,
    eventId: number,
    deviceId: number | null,
  ) => ({
    employeeId,
    sessionId,
    eventId,
    ...(deviceId === null ? {} : { deviceId }),
  });

  const closeSession = async (
    transaction: Transaction,
    session: {
      id: number;
      employeeId: number;
      attendanceDate: string;
      requiredMinutes: number;
      checkInAt: Date;
    },
    occurredAt: Date,
    snapshot: EventSnapshot & { source: EventSnapshot['source'] | 'automatic_timeout' },
    automatic: boolean,
  ): Promise<AttendanceMutationResult> => {
    const timeoutAt = new Date(session.checkInAt.getTime() + 16 * 60 * 60_000);
    if (!automatic && occurredAt.getTime() >= timeoutAt.getTime()) {
      return closeSession(transaction, session, timeoutAt, {
        source: 'automatic_timeout',
        deviceId: null,
        latitude: null,
        longitude: null,
        gpsAccuracyMeters: null,
        distanceMeters: null,
        branchLatitude: snapshot.branchLatitude,
        branchLongitude: snapshot.branchLongitude,
        branchRadiusMeters: snapshot.branchRadiusMeters,
        approvedDeniedAttemptId: null,
      }, true);
    }
    const before = await findSession(transaction, session.id);
    if (!before) throw new Error('Attendance session disappeared before check-out');
    if (occurredAt.getTime() <= session.checkInAt.getTime()) return { kind: 'invalid_time' };
    if (await isFinanciallyLocked(session.employeeId, session.attendanceDate, transaction)) {
      return { kind: 'financially_locked' };
    }
    const minutes = calculateAttendanceMinutes(
      session.checkInAt,
      occurredAt,
      session.requiredMinutes,
    );
    const changedAt = now();
    await transaction.update(attendanceSessions).set({
      checkOutAt: occurredAt,
      ...minutes,
      ...(automatic ? { automaticTimeoutAt: occurredAt, flagged: true } : {}),
      updatedAt: changedAt,
    }).where(and(
      eq(attendanceSessions.id, session.id),
      isNull(attendanceSessions.checkOutAt),
    ));
    if (!automatic) {
      const scheduledJob = (await transaction.select().from(attendanceJobs).where(and(
        eq(attendanceJobs.sessionId, session.id),
        eq(attendanceJobs.status, 'scheduled'),
      )).for('update').limit(1))[0];
      await transaction.update(attendanceJobs).set({
        status: 'completed',
        completedAt: changedAt,
        updatedAt: changedAt,
      }).where(and(
        eq(attendanceJobs.sessionId, session.id),
        eq(attendanceJobs.status, 'scheduled'),
      ));
      if (scheduledJob) {
        const completedJob = await findJob(transaction, scheduledJob.id);
        if (!completedJob) throw new Error('Completed attendance job disappeared');
        await writeJobAudit(
          transaction,
          'job_cancel_timeout',
          scheduledJob,
          completedJob,
          changedAt,
        );
      }
    }
    const eventId = await insertEvent(transaction, {
      ...snapshot,
      sessionId: session.id,
      employeeId: session.employeeId,
      eventType: 'check_out',
      occurredAt,
    });
    const auditActor = actorFor(snapshot.source, session.employeeId);
    const activeSessions = await transaction.select({ id: authSessions.id })
      .from(authSessions).where(and(
        eq(authSessions.employeeId, session.employeeId),
        isNull(authSessions.revokedAt),
      )).for('update');
    await transaction.update(authSessions).set({ revokedAt: changedAt }).where(and(
      eq(authSessions.employeeId, session.employeeId),
      isNull(authSessions.revokedAt),
    ));
    for (const activeSession of activeSessions) {
      await writeAudit(transaction, {
        ...(auditActor ? { actor: auditActor } : {}),
        module: 'auth',
        action: 'session_revoke',
        entityType: 'session',
        entityId: activeSession.id,
        relatedIds: { employeeId: session.employeeId },
        createdAt: changedAt,
      });
    }
    const updated = await findSession(transaction, session.id);
    if (!updated) throw new Error('Attendance session disappeared during check-out');
    await writeAudit(transaction, {
      ...(auditActor ? { actor: auditActor } : {}),
      module: 'attendance',
      action: automatic ? 'automatic_timeout' : snapshot.source === 'admin_manual'
        ? 'manual_check_out' : snapshot.source === 'admin_approved_denied'
          ? 'approve_denied_check_out' : 'employee_check_out',
      entityType: 'attendance_session',
      entityId: session.id,
      beforeState: before,
      afterState: updated,
      relatedIds: attendanceRelatedIds(session.employeeId, session.id, eventId, snapshot.deviceId),
      createdAt: changedAt,
    });
    return { kind: 'success', session: updated };
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
    if (await isFinanciallyLocked(employee.id, attendanceDate, transaction)) {
      return { kind: 'financially_locked' };
    }
    const daily = (await transaction.select({
      id: attendanceDailyRecords.id,
      status: attendanceDailyRecords.status,
      attendanceDate: attendanceDailyRecords.attendanceDate,
      absenceRequiredMinutes: attendanceDailyRecords.absenceRequiredMinutes,
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
    if (!employee || employee.deletedAt || employee.credentialVersion !== input.expectedCredentialVersion) {
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
    const creationDate = calendarDateInTimeZone(employee.createdAt, timeZone);
    const deletionDate = employee.deletedAt
      ? calendarDateInTimeZone(employee.deletedAt, timeZone)
      : null;
    if (creationDate >= attendanceDate || (deletionDate !== null && deletionDate <= attendanceDate)) {
      return 0;
    }
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

  return {
    async findMissingAbsenceScheduleStart(throughDate) {
      const firstScheduledDate = (await database.select({
        attendanceDate: attendanceJobs.attendanceDate,
      }).from(attendanceJobs).where(eq(attendanceJobs.jobType, 'absence_generation'))
        .orderBy(asc(attendanceJobs.attendanceDate)).limit(1))[0]?.attendanceDate;
      const startDate = firstScheduledDate && firstScheduledDate < throughDate
        ? firstScheduledDate
        : throughDate;
      const scheduled = await database.select({ attendanceDate: attendanceJobs.attendanceDate })
        .from(attendanceJobs).where(and(
          eq(attendanceJobs.jobType, 'absence_generation'),
          gte(attendanceJobs.attendanceDate, startDate),
          lte(attendanceJobs.attendanceDate, throughDate),
        ));
      const scheduledDates = new Set(scheduled.map(({ attendanceDate }) => attendanceDate));
      let candidate = startDate;
      while (candidate <= throughDate) {
        if (!scheduledDates.has(candidate)) return candidate;
        const [year, month, day] = candidate.split('-').map(Number) as [number, number, number];
        candidate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
      }
      return null;
    },

    async readPayrollFacts(employeeId, payrollMonth, context, mode) {
      const executor = context as Executor;
      const employee = (await executor.select({
        createdAt: employees.createdAt,
        deletedAt: employees.deletedAt,
      }).from(employees).where(eq(employees.id, employeeId)).limit(1))[0];
      if (!employee) return { kind: 'blocked', reasons: ['ATTENDANCE_EMPLOYEE_NOT_FOUND'] };

      const [year, monthNumber] = payrollMonth.split('-').map(Number) as [number, number];
      const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
      const monthStart = `${payrollMonth}-01`;
      const monthEnd = `${payrollMonth}-${String(daysInMonth).padStart(2, '0')}`;
      const sessions = await executor.select({
        attendanceDate: attendanceSessions.attendanceDate,
        requiredMinutes: attendanceSessions.requiredMinutes,
        checkOutAt: attendanceSessions.checkOutAt,
        overtimeMinutes: attendanceSessions.overtimeMinutes,
        shortageMinutes: attendanceSessions.shortageMinutes,
      }).from(attendanceSessions).where(and(
        eq(attendanceSessions.employeeId, employeeId),
        gte(attendanceSessions.attendanceDate, monthStart),
        lte(attendanceSessions.attendanceDate, monthEnd),
      ));
      const dailyRecords = await executor.select({
        attendanceDate: attendanceDailyRecords.attendanceDate,
        status: attendanceDailyRecords.status,
        requiredMinutes: attendanceDailyRecords.absenceRequiredMinutes,
      }).from(attendanceDailyRecords).where(and(
        eq(attendanceDailyRecords.employeeId, employeeId),
        gte(attendanceDailyRecords.attendanceDate, monthStart),
        lte(attendanceDailyRecords.attendanceDate, monthEnd),
      ));
      const pendingDenied = await executor.select({
        eventType: attendanceDeniedAttempts.eventType,
        occurredAt: attendanceDeniedAttempts.occurredAt,
      })
        .from(attendanceDeniedAttempts).where(and(
          eq(attendanceDeniedAttempts.employeeId, employeeId),
          isNull(attendanceDeniedAttempts.approvedAt),
          isNull(attendanceDeniedAttempts.dismissedAt),
          gte(attendanceDeniedAttempts.occurredAt, startOfDate(monthStart, timeZone)),
          lte(attendanceDeniedAttempts.occurredAt, endOfDate(monthEnd, timeZone)),
        ));

      const reasons: string[] = [];
      const sessionByDate = new Map(sessions.map((session) => [session.attendanceDate, session]));
      const dailyByDate = new Map(dailyRecords.map((record) => [record.attendanceDate, record]));
      if (mode === 'finalize') {
        if (sessions.some(({ checkOutAt }) => checkOutAt === null)) reasons.push('OPEN_SESSION');
        const hasDeniedCheckout = pendingDenied.some(({ eventType }) => eventType === 'check_out');
        const openSession = hasDeniedCheckout
          ? (await executor.select({ checkInAt: attendanceSessions.checkInAt })
              .from(attendanceSessions)
              .where(eq(attendanceSessions.openEmployeeId, employeeId)).limit(1))[0]
          : undefined;
        const actionableDenied = pendingDenied.some((attempt) => {
          if (attempt.eventType === 'check_out') {
            return openSession !== undefined
              && attempt.occurredAt.getTime() > openSession.checkInAt.getTime();
          }
          const attendanceDate = calendarDateInTimeZone(attempt.occurredAt, timeZone);
          return !sessionByDate.has(attendanceDate)
            && dailyByDate.get(attendanceDate)?.status !== 'weekly_day_off';
        });
        if (actionableDenied) reasons.push('DENIED_ATTEMPT');
      }
      const creationDate = calendarDateInTimeZone(employee.createdAt, timeZone);
      const deletionDate = employee.deletedAt
        ? calendarDateInTimeZone(employee.deletedAt, timeZone)
        : null;
      const currentDate = calendarDateInTimeZone(now(), timeZone);
      for (let day = 1; day <= daysInMonth; day += 1) {
        const attendanceDate = `${payrollMonth}-${String(day).padStart(2, '0')}`;
        const employmentInterior = attendanceDate > creationDate
          && (deletionDate === null || attendanceDate < deletionDate);
        if (attendanceDate < currentDate && employmentInterior
          && !sessionByDate.has(attendanceDate) && !dailyByDate.has(attendanceDate)) {
          reasons.push('ATTENDANCE_RECONCILIATION_PENDING');
          break;
        }
      }
      if (reasons.length) return { kind: 'blocked', reasons };

      let eligibleWorkdays = 0;
      let requiredMinutes = 0;
      let overtimeMinutes = 0;
      let shortageMinutes = 0;
      for (const session of sessions) {
        eligibleWorkdays += 1;
        requiredMinutes += session.requiredMinutes;
        overtimeMinutes += session.overtimeMinutes ?? 0;
        shortageMinutes += session.shortageMinutes ?? 0;
      }
      for (const record of dailyRecords) {
        if (record.status !== 'absence') continue;
        eligibleWorkdays += 1;
        requiredMinutes += record.requiredMinutes;
        shortageMinutes += record.requiredMinutes;
      }
      const weeklyDays = new Set(dailyRecords
        .filter(({ status }) => status === 'weekly_day_off')
        .map(({ attendanceDate }) => attendanceDate));
      return {
        kind: 'ready',
        facts: {
          fullMonthWorkdays: daysInMonth - weeklyDays.size,
          eligibleWorkdays,
          requiredMinutes,
          overtimeMinutes,
          shortageMinutes,
        },
      };
    },

    async findIdentityByCode(code) {
      return (await database.select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        pinHash: employees.pinHash,
        credentialVersion: employees.credentialVersion,
        deletedAt: employees.deletedAt,
        branchId: employees.branchId,
        branchLatitude: branches.latitude,
        branchLongitude: branches.longitude,
        branchRadiusMeters: branches.attendanceRadiusMeters,
        personalPhotoPath: employeeImages.storagePath,
      }).from(employees).innerJoin(branches, eq(branches.id, employees.branchId))
        .leftJoin(employeeImages, and(
          eq(employeeImages.employeeId, employees.id),
          eq(employeeImages.kind, 'personal'),
        ))
        .where(eq(employees.employeeCode, code)).limit(1))[0] ?? null;
    },

    async recordDeniedAttempt(input) {
      return database.transaction(async (transaction) => {
        const createdAt = now();
        const inserted = await transaction.insert(attendanceDeniedAttempts).values({
          ...input,
          approvedAt: null,
          approvedSessionId: null,
          dismissedAt: null,
          createdAt,
        });
        const id = Number(inserted[0].insertId);
        const stored = await findDenied(transaction, id);
        if (!stored) throw new Error('Denied attendance attempt disappeared after insert');
        await writeAudit(transaction, {
          actor: { type: 'employee', identifier: String(input.claimedEmployeeCode) },
          module: 'attendance',
          action: input.suspicious ? 'flag_denied_attempt' : 'deny_attempt',
          entityType: 'attendance_denied_attempt',
          entityId: id,
          afterState: stored,
          relatedIds: {
            ...(input.employeeId === null ? {} : { employeeId: input.employeeId }),
            ...(input.deviceId === null ? {} : { deviceId: input.deviceId }),
          },
          createdAt,
        });
        return stored;
      });
    },

    checkIn(input) {
      return database.transaction(async (transaction) => {
        const verified = await employeeMutationSnapshot(transaction, input);
        if ('failure' in verified) return verified.failure;
        return createCheckIn(transaction, {
          employeeId: input.employeeId,
          occurredAt: input.occurredAt,
          expectedCredentialVersion: input.expectedCredentialVersion,
          verifiedDevice: {
            id: input.deviceId,
            assignmentType: input.source === 'personal_device' ? 'employee' : 'branch',
            assignmentId: input.source === 'personal_device'
              ? input.employeeId : verified.employee.branchId,
          },
          snapshot: verified.snapshot,
        });
      });
    },

    checkOut(input) {
      return database.transaction(async (transaction) => {
        const verified = await employeeMutationSnapshot(transaction, input);
        if ('failure' in verified) return verified.failure;
        const open = (await transaction.select({
          id: attendanceSessions.id,
          employeeId: attendanceSessions.employeeId,
          attendanceDate: attendanceSessions.attendanceDate,
          requiredMinutes: attendanceSessions.requiredMinutes,
          checkInAt: attendanceSessions.checkInAt,
        }).from(attendanceSessions).where(eq(attendanceSessions.openEmployeeId, input.employeeId))
          .for('update').limit(1))[0];
        if (!open) return { kind: 'no_open_session' };
        return closeSession(transaction, open, input.occurredAt, verified.snapshot, false);
      });
    },

    manualCheckIn(input) {
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, input.employeeId);
        if (!employee) return { kind: 'employee_not_found' };
        return createCheckIn(transaction, {
          employeeId: input.employeeId,
          occurredAt: input.occurredAt,
          snapshot: {
            source: 'admin_manual',
            deviceId: null,
            latitude: null,
            longitude: null,
            gpsAccuracyMeters: null,
            distanceMeters: null,
            branchLatitude: employee.branchLatitude,
            branchLongitude: employee.branchLongitude,
            branchRadiusMeters: employee.branchRadiusMeters,
            approvedDeniedAttemptId: null,
          },
        });
      });
    },

    manualCheckOut(input) {
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, input.employeeId);
        if (!employee) return { kind: 'employee_not_found' };
        const open = (await transaction.select({
          id: attendanceSessions.id,
          employeeId: attendanceSessions.employeeId,
          attendanceDate: attendanceSessions.attendanceDate,
          requiredMinutes: attendanceSessions.requiredMinutes,
          checkInAt: attendanceSessions.checkInAt,
        }).from(attendanceSessions).where(eq(attendanceSessions.openEmployeeId, input.employeeId))
          .for('update').limit(1))[0];
        if (!open) return { kind: 'no_open_session' };
        return closeSession(transaction, open, input.occurredAt, {
          source: 'admin_manual',
          deviceId: null,
          latitude: null,
          longitude: null,
          gpsAccuracyMeters: null,
          distanceMeters: null,
          branchLatitude: employee.branchLatitude,
          branchLongitude: employee.branchLongitude,
          branchRadiusMeters: employee.branchRadiusMeters,
          approvedDeniedAttemptId: null,
        }, false);
      });
    },

    approveDeniedAttempt(id) {
      return database.transaction(async (transaction) => {
        const attempt = (await transaction.select().from(attendanceDeniedAttempts)
          .where(eq(attendanceDeniedAttempts.id, id)).for('update').limit(1))[0];
        if (!attempt) return { kind: 'not_found' };
        if (attempt.approvedAt) return { kind: 'already_approved' };
        if (attempt.dismissedAt) return { kind: 'already_reviewed' };
        if (!attempt.employeeId) return { kind: 'employee_not_found' };
        const employee = await lockEmployee(transaction, attempt.employeeId);
        if (!employee) return { kind: 'employee_not_found' };
        const snapshot: EventSnapshot = {
          source: 'admin_approved_denied',
          deviceId: attempt.deviceId,
          latitude: attempt.latitude,
          longitude: attempt.longitude,
          gpsAccuracyMeters: attempt.gpsAccuracyMeters,
          distanceMeters: attempt.distanceMeters,
          branchLatitude: attempt.branchLatitude ?? employee.branchLatitude,
          branchLongitude: attempt.branchLongitude ?? employee.branchLongitude,
          branchRadiusMeters: attempt.branchRadiusMeters ?? employee.branchRadiusMeters,
          approvedDeniedAttemptId: attempt.id,
        };
        let result: AttendanceMutationResult;
        if (attempt.eventType === 'check_in') {
          result = await createCheckIn(transaction, {
            employeeId: employee.id,
            occurredAt: attempt.occurredAt,
            snapshot,
          });
        } else {
          const open = (await transaction.select({
            id: attendanceSessions.id,
            employeeId: attendanceSessions.employeeId,
            attendanceDate: attendanceSessions.attendanceDate,
            requiredMinutes: attendanceSessions.requiredMinutes,
            checkInAt: attendanceSessions.checkInAt,
          }).from(attendanceSessions).where(eq(attendanceSessions.openEmployeeId, employee.id))
            .for('update').limit(1))[0];
          result = open
            ? await closeSession(transaction, open, attempt.occurredAt, snapshot, false)
            : { kind: 'no_open_session' };
        }
        if (result.kind !== 'success') return result;
        const approvedAt = now();
        await transaction.update(attendanceDeniedAttempts).set({
          approvedAt,
          approvedSessionId: result.session.id,
        }).where(and(
          eq(attendanceDeniedAttempts.id, id),
          isNull(attendanceDeniedAttempts.approvedAt),
          isNull(attendanceDeniedAttempts.dismissedAt),
        ));
        const updatedAttempt = await findDenied(transaction, id);
        await writeAudit(transaction, {
          module: 'attendance',
          action: 'approve_denied_attempt',
          entityType: 'attendance_denied_attempt',
          entityId: id,
          beforeState: attempt,
          afterState: updatedAttempt,
          relatedIds: { employeeId: employee.id, sessionId: result.session.id },
          createdAt: approvedAt,
        });
        return result;
      });
    },

    dismissDeniedAttempt(id) {
      return database.transaction(async (transaction) => {
        const attempt = (await transaction.select().from(attendanceDeniedAttempts)
          .where(eq(attendanceDeniedAttempts.id, id)).for('update').limit(1))[0];
        if (!attempt) return { kind: 'not_found' as const };
        if (attempt.approvedAt || attempt.dismissedAt) return { kind: 'already_reviewed' as const };
        const dismissedAt = now();
        await transaction.update(attendanceDeniedAttempts).set({ dismissedAt }).where(and(
          eq(attendanceDeniedAttempts.id, id),
          isNull(attendanceDeniedAttempts.approvedAt),
          isNull(attendanceDeniedAttempts.dismissedAt),
        ));
        const dismissed = await findDenied(transaction, id);
        if (!dismissed) throw new Error('Dismissed attendance attempt disappeared');
        await writeAudit(transaction, {
          module: 'attendance',
          action: 'dismiss_denied_attempt',
          entityType: 'attendance_denied_attempt',
          entityId: id,
          beforeState: attempt,
          afterState: dismissed,
          relatedIds: {
            ...(attempt.employeeId === null ? {} : { employeeId: attempt.employeeId }),
          },
          createdAt: dismissedAt,
        });
        return { kind: 'success' as const, attempt: dismissed };
      });
    },

    correctAutomaticTimeout(id, checkOutAt) {
      return database.transaction(async (transaction) => {
        const target = (await transaction.select({ employeeId: attendanceSessions.employeeId })
          .from(attendanceSessions).where(eq(attendanceSessions.id, id)).limit(1))[0];
        if (!target) return { kind: 'not_found' };
        await lockEmployee(transaction, target.employeeId);
        const row = (await transaction.select({
          id: attendanceSessions.id,
          employeeId: attendanceSessions.employeeId,
          attendanceDate: attendanceSessions.attendanceDate,
          requiredMinutes: attendanceSessions.requiredMinutes,
          checkInAt: attendanceSessions.checkInAt,
          checkOutAt: attendanceSessions.checkOutAt,
          automaticTimeoutAt: attendanceSessions.automaticTimeoutAt,
        }).from(attendanceSessions).where(and(
          eq(attendanceSessions.id, id),
          eq(attendanceSessions.employeeId, target.employeeId),
        ))
          .for('update').limit(1))[0];
        if (!row) return { kind: 'not_found' };
        if (!row.automaticTimeoutAt || !row.checkOutAt) return { kind: 'not_automatic_timeout' };
        if (checkOutAt.getTime() <= row.checkInAt.getTime()) return { kind: 'invalid_time' };
        if (await isFinanciallyLocked(row.employeeId, row.attendanceDate, transaction)) {
          return { kind: 'financially_locked' };
        }
        const before = await findSession(transaction, id);
        const correctedAt = now();
        await transaction.update(attendanceSessions).set({
          checkOutAt,
          ...calculateAttendanceMinutes(row.checkInAt, checkOutAt, row.requiredMinutes),
          automaticTimeoutCorrectedAt: correctedAt,
          updatedAt: correctedAt,
        }).where(eq(attendanceSessions.id, id));
        const updated = await findSession(transaction, id);
        if (!updated) throw new Error('Attendance session disappeared during correction');
        await writeAudit(transaction, {
          module: 'attendance',
          action: 'correct_automatic_timeout',
          entityType: 'attendance_session',
          entityId: id,
          beforeState: before,
          afterState: updated,
          relatedIds: { employeeId: row.employeeId },
          createdAt: correctedAt,
        });
        return { kind: 'success', session: updated };
      });
    },

    getSession(id) {
      return findSession(database, id);
    },

    async listSessions(query) {
      const filters: SQL[] = [];
      if (query.employeeId !== undefined) filters.push(eq(attendanceSessions.employeeId, query.employeeId));
      if (query.branchId !== undefined) filters.push(eq(sessionBranchId, query.branchId));
      if (query.state === 'open') filters.push(isNull(attendanceSessions.checkOutAt));
      if (query.state === 'closed') filters.push(isNotNull(attendanceSessions.checkOutAt));
      if (query.dateFrom !== undefined) filters.push(gte(attendanceSessions.attendanceDate, query.dateFrom));
      if (query.dateTo !== undefined) filters.push(lte(attendanceSessions.attendanceDate, query.dateTo));
      if (query.search !== undefined) filters.push(or(
        sql`locate(${query.search}, ${employees.fullName}) > 0`,
        sql`locate(${query.search}, cast(${employees.employeeCode} as char)) > 0`,
        sql`locate(${query.search}, ${branches.name}) > 0`,
      )!);
      const where = filters.length ? and(...filters) : undefined;
      const items = await database.select(sessionFields).from(attendanceSessions)
        .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
        .leftJoin(employeeBranchAssignments, sessionBranchAssignment)
        .innerJoin(branches, eq(branches.id, sessionBranchId))
        .where(where).orderBy(desc(attendanceSessions.attendanceDate), asc(employees.employeeCode))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      const totals = await database.select({ value: count() }).from(attendanceSessions)
        .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
        .leftJoin(employeeBranchAssignments, sessionBranchAssignment)
        .innerJoin(branches, eq(branches.id, sessionBranchId)).where(where);
      return { items, total: totals[0]?.value ?? 0 };
    },

    async listDeniedAttempts(query) {
      const filters: SQL[] = [];
      if (query.employeeId !== undefined) filters.push(eq(attendanceDeniedAttempts.employeeId, query.employeeId));
      if (query.branchId !== undefined) filters.push(eq(employees.branchId, query.branchId));
      if (query.eventType !== undefined) filters.push(eq(attendanceDeniedAttempts.eventType, query.eventType));
      if (query.suspicious !== undefined) filters.push(eq(attendanceDeniedAttempts.suspicious, query.suspicious));
      if (query.approvalState === 'pending') filters.push(and(
        isNull(attendanceDeniedAttempts.approvedAt),
        isNull(attendanceDeniedAttempts.dismissedAt),
      )!);
      if (query.approvalState === 'approved') filters.push(isNotNull(attendanceDeniedAttempts.approvedAt));
      if (query.approvalState === 'dismissed') filters.push(isNotNull(attendanceDeniedAttempts.dismissedAt));
      if (query.dateFrom !== undefined) filters.push(gte(attendanceDeniedAttempts.occurredAt, startOfDate(query.dateFrom, timeZone)));
      if (query.dateTo !== undefined) filters.push(lte(attendanceDeniedAttempts.occurredAt, endOfDate(query.dateTo, timeZone)));
      if (query.search !== undefined) filters.push(or(
        sql`locate(${query.search}, cast(${attendanceDeniedAttempts.claimedEmployeeCode} as char)) > 0`,
        sql`locate(${query.search}, coalesce(${employees.fullName}, '')) > 0`,
        sql`locate(${query.search}, coalesce(${branches.name}, '')) > 0`,
        sql`locate(${query.search}, ${attendanceDeniedAttempts.failureReason}) > 0`,
      )!);
      const where = filters.length ? and(...filters) : undefined;
      const items = await database.select(deniedFields).from(attendanceDeniedAttempts)
        .leftJoin(employees, eq(employees.id, attendanceDeniedAttempts.employeeId))
        .leftJoin(branches, eq(branches.id, employees.branchId))
        .where(where).orderBy(desc(attendanceDeniedAttempts.occurredAt), desc(attendanceDeniedAttempts.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      const totals = await database.select({ value: count() }).from(attendanceDeniedAttempts)
        .leftJoin(employees, eq(employees.id, attendanceDeniedAttempts.employeeId))
        .leftJoin(branches, eq(branches.id, employees.branchId)).where(where);
      return { items, total: totals[0]?.value ?? 0 };
    },

    ensureAbsenceJob(attendanceDate, runAt) {
      return database.transaction(async (transaction) => {
        const createdAt = now();
        const inserted = await transaction.insert(attendanceJobs).values({
          jobType: 'absence_generation',
          sessionId: null,
          attendanceDate,
          status: 'scheduled',
          runAt,
          attemptCount: 0,
          lastError: null,
          startedAt: null,
          completedAt: null,
          createdAt,
          updatedAt: createdAt,
        }).onDuplicateKeyUpdate({ set: { id: sql`${attendanceJobs.id}` } });
        const scheduled = (await transaction.select().from(attendanceJobs).where(and(
          eq(attendanceJobs.jobType, 'absence_generation'),
          eq(attendanceJobs.attendanceDate, attendanceDate),
        )).limit(1))[0];
        if (!scheduled) throw new Error('Scheduled absence job disappeared');
        if (inserted[0].affectedRows === 1 && Number(inserted[0].insertId) === scheduled.id) {
          await writeJobAudit(transaction, 'job_schedule', null, scheduled, createdAt);
        }
        return scheduled;
      });
    },

    claimNext() {
      return database.transaction(async (transaction) => {
        const claimedAt = now();
        const due = (await transaction.select().from(attendanceJobs).where(and(
          eq(attendanceJobs.status, 'scheduled'),
          lte(attendanceJobs.runAt, claimedAt),
        )).orderBy(asc(attendanceJobs.runAt), asc(attendanceJobs.id))
          .for('update').limit(1))[0];
        if (!due) return null;
        await transaction.update(attendanceJobs).set({
          status: 'processing',
          attemptCount: sql`${attendanceJobs.attemptCount} + 1`,
          startedAt: claimedAt,
          completedAt: null,
          updatedAt: claimedAt,
        }).where(and(
          eq(attendanceJobs.id, due.id),
          eq(attendanceJobs.status, 'scheduled'),
        ));
        const claimed = await findJob(transaction, due.id);
        if (!claimed) throw new Error('Claimed attendance job disappeared');
        await writeJobAudit(transaction, 'job_claim', due, claimed, claimedAt);
        return claimed;
      });
    },

    processAutomaticTimeout(sessionId) {
      return database.transaction(async (transaction) => {
        const target = (await transaction.select({ employeeId: attendanceSessions.employeeId })
          .from(attendanceSessions).where(eq(attendanceSessions.id, sessionId)).limit(1))[0];
        if (!target) throw new Error('Attendance session for timeout job does not exist');
        const employee = await lockEmployee(transaction, target.employeeId);
        if (!employee) throw new Error('Employee for timeout job does not exist');
        const session = (await transaction.select({
          id: attendanceSessions.id,
          employeeId: attendanceSessions.employeeId,
          attendanceDate: attendanceSessions.attendanceDate,
          requiredMinutes: attendanceSessions.requiredMinutes,
          checkInAt: attendanceSessions.checkInAt,
          checkOutAt: attendanceSessions.checkOutAt,
        }).from(attendanceSessions).where(and(
          eq(attendanceSessions.id, sessionId),
          eq(attendanceSessions.employeeId, target.employeeId),
        )).for('update').limit(1))[0];
        if (!session) throw new Error('Attendance session for timeout job disappeared');
        if (session.checkOutAt) return;
        const timeoutAt = new Date(session.checkInAt.getTime() + 16 * 60 * 60_000);
        if (timeoutAt.getTime() > now().getTime()) throw new Error('Attendance timeout job is not due');
        const result = await closeSession(transaction, session, timeoutAt, {
          source: 'automatic_timeout',
          deviceId: null,
          latitude: null,
          longitude: null,
          gpsAccuracyMeters: null,
          distanceMeters: null,
          branchLatitude: employee.branchLatitude,
          branchLongitude: employee.branchLongitude,
          branchRadiusMeters: employee.branchRadiusMeters,
          approvedDeniedAttemptId: null,
        }, true);
        if (result.kind !== 'success') {
          throw new Error(`Automatic timeout could not complete: ${result.kind}`);
        }
      });
    },

    async generateAbsences(attendanceDate) {
      if (endOfDate(attendanceDate, timeZone).getTime() >= now().getTime()) {
        throw new Error('Absence generation date has not ended');
      }
      const candidates = await database.select({
        id: employees.id,
        createdAt: employees.createdAt,
        deletedAt: employees.deletedAt,
      }).from(employees);
      let createdCount = 0;
      for (const candidate of candidates) {
        const creationDate = calendarDateInTimeZone(candidate.createdAt, timeZone);
        const deletionDate = candidate.deletedAt
          ? calendarDateInTimeZone(candidate.deletedAt, timeZone)
          : null;
        if (creationDate >= attendanceDate || (deletionDate !== null && deletionDate <= attendanceDate)) {
          continue;
        }
        createdCount += await database.transaction((transaction) => (
          createAbsenceForEmployee(transaction, candidate.id, attendanceDate)
        ));
      }
      return createdCount;
    },

    async reconcileDueAbsencesForEmployee(employeeId, previousRequiredMinutes, context) {
      const rolloutDate = (await context.select({ attendanceDate: attendanceJobs.attendanceDate })
        .from(attendanceJobs)
        .where(eq(attendanceJobs.jobType, 'absence_generation'))
        .orderBy(asc(attendanceJobs.attendanceDate))
        .limit(1))[0]?.attendanceDate;
      if (rolloutDate === undefined || rolloutDate === null) return 0;

      const currentDate = calendarDateInTimeZone(now(), timeZone);
      let createdCount = 0;
      for (
        let attendanceDate = rolloutDate;
        attendanceDate < currentDate;
        attendanceDate = nextCalendarDate(attendanceDate)
      ) {
        createdCount += await createAbsenceForEmployee(
          context,
          employeeId,
          attendanceDate,
          previousRequiredMinutes,
        );
      }
      return createdCount;
    },

    complete(id) {
      return database.transaction(async (transaction) => {
        const completedAt = now();
        const before = (await transaction.select().from(attendanceJobs)
          .where(eq(attendanceJobs.id, id)).for('update').limit(1))[0];
        if (!before || before.status === 'completed') return;
        await transaction.update(attendanceJobs).set({
          status: 'completed',
          completedAt,
          updatedAt: completedAt,
        }).where(eq(attendanceJobs.id, id));
        const after = await findJob(transaction, id);
        if (!after) throw new Error('Completed attendance job disappeared');
        await writeJobAudit(transaction, 'job_complete', before, after, completedAt);
      });
    },

    fail(id, reason) {
      return database.transaction(async (transaction) => {
        const failedAt = now();
        const before = (await transaction.select().from(attendanceJobs)
          .where(eq(attendanceJobs.id, id)).for('update').limit(1))[0];
        if (!before || before.status !== 'processing') return;
        const status = before.attemptCount >= 3 ? 'failed' as const : 'scheduled' as const;
        await transaction.update(attendanceJobs).set({
          status,
          lastError: reason.slice(0, 1000),
          ...(status === 'scheduled' ? { startedAt: null } : {}),
          updatedAt: failedAt,
        }).where(eq(attendanceJobs.id, id));
        const after = await findJob(transaction, id);
        if (!after) throw new Error('Failed attendance job disappeared');
        await writeJobAudit(
          transaction,
          status === 'failed' ? 'job_failed' : 'job_retry',
          before,
          after,
          failedAt,
        );
      });
    },

    recoverStale(staleBefore) {
      return database.transaction(async (transaction) => {
        const recoveredAt = now();
        const stale = await transaction.select().from(attendanceJobs).where(and(
          eq(attendanceJobs.status, 'processing'),
          lte(attendanceJobs.startedAt, staleBefore),
        )).for('update');
        for (const job of stale) {
          const status = job.attemptCount >= 3 ? 'failed' as const : 'scheduled' as const;
          await transaction.update(attendanceJobs).set({
            status,
            lastError: 'WORKER_INTERRUPTED',
            ...(status === 'scheduled' ? { startedAt: null } : {}),
            updatedAt: recoveredAt,
          }).where(eq(attendanceJobs.id, job.id));
          const recovered = await findJob(transaction, job.id);
          if (!recovered) throw new Error('Recovered attendance job disappeared');
          await writeJobAudit(transaction, 'job_recover', job, recovered, recoveredAt);
        }
        return stale.length;
      });
    },

    reconcileFailed() {
      return database.transaction(async (transaction) => {
        const reconciledAt = now();
        const failed = await transaction.select().from(attendanceJobs)
          .where(eq(attendanceJobs.status, 'failed')).for('update');
        for (const job of failed) {
          await transaction.update(attendanceJobs).set({
            status: 'scheduled',
            runAt: reconciledAt,
            startedAt: null,
            completedAt: null,
            updatedAt: reconciledAt,
          }).where(eq(attendanceJobs.id, job.id));
          const reconciled = await findJob(transaction, job.id);
          if (!reconciled) throw new Error('Reconciled attendance job disappeared');
          await writeJobAudit(transaction, 'job_reconcile', job, reconciled, reconciledAt);
        }
        return failed.length;
      });
    },

    async hasOpenSession(employeeId, context) {
      const executor = (context as Executor | undefined) ?? database;
      const activeAfter = new Date(now().getTime() - 16 * 60 * 60_000);
      return (await executor.select({ id: attendanceSessions.id }).from(attendanceSessions)
        .where(and(
          eq(attendanceSessions.openEmployeeId, employeeId),
          gt(attendanceSessions.checkInAt, activeAfter),
        )).limit(1))[0] !== undefined;
    },
    async hasAnyOpenSession(employeeId, context) {
      const executor = (context as Executor | undefined) ?? database;
      return (await executor.select({ id: attendanceSessions.id }).from(attendanceSessions)
        .where(eq(attendanceSessions.openEmployeeId, employeeId)).limit(1))[0] !== undefined;
    },
  };
};
