import {
  attendanceDeniedAttempts,
  attendanceSessions,
  branches,
  employees,
} from '@capella/database/schema';
import { and, count, desc, eq, gte, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import { endOfDate, startOfDate } from './attendance-calendar.js';
import {
  deniedFields,
  findDenied,
  lockEmployee,
  type Database,
  type EventSnapshot,
} from './attendance-repository-support.js';
import { type AttendanceSessionWriter } from './attendance-session-writer.js';
import type { AttendanceMutationResult, AttendanceRepository } from './attendance-service.js';

export const createAttendanceDeniedRepository = (
  database: Database,
  writer: AttendanceSessionWriter,
  options: { now: () => Date; timeZone: string },
): Pick<AttendanceRepository,
  'recordDeniedAttempt' | 'approveDeniedAttempt' | 'dismissDeniedAttempt' | 'listDeniedAttempts'
> => {
  const { now, timeZone } = options;

  return {
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
          result = await writer.createCheckIn(transaction, {
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
            ? await writer.closeSession(transaction, open, attempt.occurredAt, snapshot, false)
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
        if (!updatedAttempt) throw new Error('Approved attendance attempt disappeared');
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
  };
};
