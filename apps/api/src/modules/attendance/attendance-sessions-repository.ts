import {
  attendanceSessions,
  branches,
  employeeBranchAssignments,
  employeeImages,
  employees,
} from '@capella/database/schema';
import { and, asc, count, desc, eq, gt, gte, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import {
  findSession,
  lockEmployee,
  sessionBranchAssignment,
  sessionBranchId,
  sessionFields,
  type Database,
  type Executor,
} from './attendance-repository-support.js';
import { type AttendanceSessionWriter } from './attendance-session-writer.js';
import { calculateAttendanceMinutes, type AttendanceRepository } from './attendance-service.js';
import type { ErpAttendanceCapability } from './erp-attendance-capability.js';

export const createAttendanceSessionsRepository = (
  database: Database,
  writer: AttendanceSessionWriter,
  options: {
    now: () => Date;
    isFinanciallyLocked: (
      employeeId: number,
      attendanceDate: string,
      context: Parameters<AttendanceSessionWriter['closeSession']>[0],
    ) => Promise<boolean>;
  },
): Pick<AttendanceRepository,
  | 'findIdentityByCode'
  | 'checkIn'
  | 'checkOut'
  | 'manualCheckIn'
  | 'manualCheckOut'
  | 'correctAutomaticTimeout'
  | 'getSession'
  | 'listSessions'
  | 'hasOpenSession'
  | 'hasAnyOpenSession'
> & ErpAttendanceCapability => {
  const { now, isFinanciallyLocked } = options;

  return {
    async findIdentityByCode(code) {
      return (await database.select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        pinHash: employees.pinHash,
        credentialVersion: employees.credentialVersion,
        employmentStatus: employees.employmentStatus,
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

    checkIn(input) {
      return database.transaction(async (transaction) => {
        const verified = await writer.employeeMutationSnapshot(transaction, input);
        if ('failure' in verified) return verified.failure;
        return writer.createCheckIn(transaction, {
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
        const verified = await writer.employeeMutationSnapshot(transaction, input);
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
        return writer.closeSession(transaction, open, input.occurredAt, verified.snapshot, false);
      });
    },

    manualCheckIn(input) {
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, input.employeeId);
        if (!employee) return { kind: 'employee_not_found' };
        return writer.createCheckIn(transaction, {
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
        return writer.closeSession(transaction, open, input.occurredAt, {
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
        // A correction cannot outlast the automatic timeout it replaces.
        if (checkOutAt.getTime() > row.checkInAt.getTime() + 16 * 60 * 60_000) {
          return { kind: 'invalid_time' };
        }
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

    listPresentEmployees(branchId) {
      const activeAfter = new Date(now().getTime() - 16 * 60 * 60_000);
      return database.select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        fullName: employees.fullName,
        branchId: attendanceSessions.branchId,
      }).from(attendanceSessions)
        .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
        .where(and(
          eq(attendanceSessions.branchId, branchId),
          isNotNull(attendanceSessions.openEmployeeId),
          gt(attendanceSessions.checkInAt, activeAfter),
          eq(employees.employmentStatus, 'active'),
          isNull(employees.deletedAt),
        ))
        .orderBy(asc(employees.employeeCode));
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
