import type { createDatabase } from '@capella/database';
import {
  attendanceDeniedAttempts,
  attendanceJobs,
  attendanceSessions,
  branches,
  employeeBranchAssignments,
  employees,
} from '@capella/database/schema';
import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import { branchIdAt } from '../../shared/database/branch-id-at.js';
import type { AttendanceDeniedAttempt, AttendanceSession } from './attendance-service.js';
import type { AttendanceJob } from './attendance-jobs.js';

export type Database = ReturnType<typeof createDatabase>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

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

export type EventSnapshot = {
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

const sessionAssignment = branchIdAt(
  employeeBranchAssignments, attendanceSessions.employeeId, attendanceSessions.checkInAt,
);
export const sessionBranchId = sql<number>`coalesce(${attendanceSessions.branchId}, ${sessionAssignment.branchId})`;
export const sessionBranchAssignment = sessionAssignment.assignment;

export const branchAt = async (
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

export const sessionFields = {
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

export const deniedFields = {
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

const employeeLockFields = {
  id: employees.id,
  employeeCode: employees.employeeCode,
  credentialVersion: employees.credentialVersion,
  employmentStatus: employees.employmentStatus,
  deletedAt: employees.deletedAt,
  createdAt: employees.createdAt,
  branchId: employees.branchId,
  branchLatitude: branches.latitude,
  branchLongitude: branches.longitude,
  branchRadiusMeters: branches.attendanceRadiusMeters,
};

export const findSession = async (
  executor: Executor,
  id: number,
): Promise<AttendanceSession | null> => (
  await executor.select(sessionFields)
    .from(attendanceSessions)
    .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
    .leftJoin(employeeBranchAssignments, sessionBranchAssignment)
    .innerJoin(branches, eq(branches.id, sessionBranchId))
    .where(eq(attendanceSessions.id, id))
    .limit(1)
)[0] ?? null;

export const findDenied = async (
  executor: Executor,
  id: number,
): Promise<AttendanceDeniedAttempt | null> => (
  await executor.select(deniedFields).from(attendanceDeniedAttempts)
    .where(eq(attendanceDeniedAttempts.id, id)).limit(1)
)[0] ?? null;

export const findJob = async (
  executor: Executor,
  id: number,
): Promise<AttendanceJob | null> => (
  await executor.select().from(attendanceJobs).where(eq(attendanceJobs.id, id)).limit(1)
)[0] ?? null;

export const lockEmployee = async (transaction: Transaction, employeeId: number) => (
  await transaction.select(employeeLockFields).from(employees)
    .innerJoin(branches, eq(branches.id, employees.branchId))
    .where(eq(employees.id, employeeId)).for('update').limit(1)
)[0];

export const actorFor = (source: EventSnapshot['source'], employeeId: number) => (
  source === 'automatic_timeout'
    ? { type: 'system' as const, identifier: 'system' }
    : source === 'personal_device' || source === 'branch_device'
      ? { type: 'employee' as const, identifier: String(employeeId) }
      : undefined
);

export const attendanceRelatedIds = (
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

export const writeJobAudit = async (
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
