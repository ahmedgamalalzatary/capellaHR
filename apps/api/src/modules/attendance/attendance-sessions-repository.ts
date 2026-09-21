import {
  attendanceDailyRecords,
  attendanceSessions,
  branches,
  employeeBranchAssignments,
  employeeEmploymentPeriods,
  employeeImages,
  employees,
} from '@capella/database/schema';
import { and, asc, between, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import { employmentDateAccruesAbsence } from '../employees/employment-period.js';
import { endOfDate, nextCalendarDate } from './attendance-calendar.js';
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
import { calculateAttendanceMinutes, type AttendanceListItem, type AttendanceRepository } from './attendance-service.js';
import type { ErpAttendanceCapability } from './erp-attendance-capability.js';

/**
 * An employee counts as present only while a session of that branch is still
 * open and inside the 16-hour ceiling, and only while the employee is active
 * and not soft-deleted.
 */
const presentInBranch = (branchId: number, at: Date) => and(
  eq(attendanceSessions.branchId, branchId),
  isNotNull(attendanceSessions.openEmployeeId),
  gt(attendanceSessions.checkInAt, new Date(at.getTime() - 16 * 60 * 60_000)),
  eq(employees.employmentStatus, 'active'),
  isNull(employees.deletedAt),
)!;

const presentEmployeeQuery = (executor: Executor, where: SQL) => executor.select({
  id: employees.id,
  employeeCode: employees.employeeCode,
  fullName: employees.fullName,
  branchId: attendanceSessions.branchId,
}).from(attendanceSessions)
  .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
  .where(where);

export const createAttendanceSessionsRepository = (
  database: Database,
  writer: AttendanceSessionWriter,
  options: {
    now: () => Date;
    timeZone: string;
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
  const { now, timeZone, isFinanciallyLocked } = options;

  const listMissingCheckIns = async (query: Parameters<AttendanceRepository['listSessions']>[0]) => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now());
    const from = query.dateFrom ?? query.dateTo ?? today;
    const to = query.dateTo ?? query.dateFrom ?? from;
    const dates: string[] = [];
    for (let date = from; date <= to && dates.length < 366; date = nextCalendarDate(date)) {
      dates.push(date);
    }
    const employeeFilters: SQL[] = [isNull(employees.deletedAt)];
    if (query.employeeId !== undefined) employeeFilters.push(eq(employees.id, query.employeeId));
    const staff = await database.select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      fullName: employees.fullName,
      branchId: employees.branchId,
      createdAt: employees.createdAt,
      shiftDurationMinutes: employees.shiftDurationMinutes,
    }).from(employees).where(and(...employeeFilters));
    if (!staff.length || !dates.length) return { items: [], total: 0 };
    const ids = staff.map((employee) => employee.id);
    const [periods, assignments, sessions, daysOff, branchRows] = await Promise.all([
      database.select({
        employeeId: employeeEmploymentPeriods.employeeId,
        activeFrom: employeeEmploymentPeriods.activeFrom,
        activeTo: employeeEmploymentPeriods.activeTo,
      }).from(employeeEmploymentPeriods).where(inArray(employeeEmploymentPeriods.employeeId, ids)),
      database.select({
        employeeId: employeeBranchAssignments.employeeId,
        branchId: employeeBranchAssignments.branchId,
        effectiveFrom: employeeBranchAssignments.effectiveFrom,
        effectiveTo: employeeBranchAssignments.effectiveTo,
      }).from(employeeBranchAssignments).where(inArray(employeeBranchAssignments.employeeId, ids)),
      database.select({
        employeeId: attendanceSessions.employeeId,
        attendanceDate: attendanceSessions.attendanceDate,
      }).from(attendanceSessions).where(and(
        inArray(attendanceSessions.employeeId, ids),
        between(attendanceSessions.attendanceDate, from, to),
      )),
      database.select({
        employeeId: attendanceDailyRecords.employeeId,
        attendanceDate: attendanceDailyRecords.attendanceDate,
      }).from(attendanceDailyRecords).where(and(
        inArray(attendanceDailyRecords.employeeId, ids),
        between(attendanceDailyRecords.attendanceDate, from, to),
        eq(attendanceDailyRecords.status, 'weekly_day_off'),
      )),
      database.select({ id: branches.id, name: branches.name }).from(branches),
    ]);
    const periodsByEmployee = new Map<number, Array<{ activeFrom: Date; activeTo: Date | null }>>();
    for (const period of periods) {
      const list = periodsByEmployee.get(period.employeeId) ?? [];
      list.push(period);
      periodsByEmployee.set(period.employeeId, list);
    }
    const checkedIn = new Set(sessions.map((row) => `${row.employeeId}:${row.attendanceDate}`));
    const off = new Set(daysOff.map((row) => `${row.employeeId}:${row.attendanceDate}`));
    const branchName = new Map(branchRows.map((branch) => [branch.id, branch.name]));
    const branchOn = (employeeId: number, instant: Date, fallback: number) => {
      const match = assignments
        .filter((assignment) => assignment.employeeId === employeeId
          && assignment.effectiveFrom.getTime() <= instant.getTime()
          && (assignment.effectiveTo === null || assignment.effectiveTo.getTime() > instant.getTime()))
        .sort((left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime())[0];
      return match?.branchId ?? fallback;
    };
    const needle = query.search;
    const rows: AttendanceListItem[] = [];
    for (const date of dates) {
      const at = endOfDate(date, timeZone);
      for (const employee of staff) {
        const employment = periodsByEmployee.get(employee.id) ?? [{
          activeFrom: employee.createdAt,
          activeTo: null,
        }];
        if (!employmentDateAccruesAbsence(date, employment, timeZone)) continue;
        if (checkedIn.has(`${employee.id}:${date}`) || off.has(`${employee.id}:${date}`)) continue;
        const branchId = branchOn(employee.id, at, employee.branchId);
        if (query.branchId !== undefined && branchId !== query.branchId) continue;
        const name = branchName.get(branchId) ?? '';
        if (needle !== undefined && !(
          employee.fullName.includes(needle)
          || String(employee.employeeCode).includes(needle)
          || name.includes(needle)
        )) continue;
        rows.push({
          id: 0,
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          employeeName: employee.fullName,
          branchId,
          branchName: name,
          attendanceDate: date,
          requiredMinutes: employee.shiftDurationMinutes,
          checkInAt: null,
          checkOutAt: null,
          workedMinutes: null,
          overtimeMinutes: null,
          shortageMinutes: null,
          automaticTimeoutAt: null,
          automaticTimeoutCorrectedAt: null,
          flagged: false,
          createdAt: at,
          updatedAt: at,
        });
      }
    }
    rows.sort((left, right) => right.attendanceDate.localeCompare(left.attendanceDate)
      || left.employeeCode - right.employeeCode);
    const start = (query.page - 1) * query.pageSize;
    return { items: rows.slice(start, start + query.pageSize), total: rows.length };
  };

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
        faceEmbedding: employees.faceEmbedding,
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
      if (query.state === 'absent') return listMissingCheckIns(query);
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
      return presentEmployeeQuery(database, presentInBranch(branchId, now()))
        .orderBy(asc(employees.employeeCode));
    },

    /**
     * Single-employee re-check used when a sale is completed. `context` is the
     * caller's transaction, so the check and the invoice write see one state.
     */
    async findPresentEmployee(branchId, employeeId, context) {
      const executor = (context as Executor | undefined) ?? database;
      if (context) {
        // Match Attendance mutation lock order (employee, then open session).
        // Holding both rows until the caller commits prevents checkout or
        // deactivation from racing a sale after its final presence check.
        const employee = (await executor.select({
          id: employees.id,
          employeeCode: employees.employeeCode,
          fullName: employees.fullName,
        }).from(employees).where(and(
          eq(employees.id, employeeId),
          eq(employees.employmentStatus, 'active'),
          isNull(employees.deletedAt),
        )).for('update').limit(1))[0];
        if (!employee) return null;
        const activeAfter = new Date(now().getTime() - 16 * 60 * 60_000);
        const session = (await executor.select({ branchId: attendanceSessions.branchId })
          .from(attendanceSessions).where(and(
            eq(attendanceSessions.branchId, branchId),
            eq(attendanceSessions.employeeId, employeeId),
            isNotNull(attendanceSessions.openEmployeeId),
            gt(attendanceSessions.checkInAt, activeAfter),
          )).for('update').limit(1))[0];
        return session ? { ...employee, branchId: session.branchId } : null;
      }
      return (await presentEmployeeQuery(executor, and(
        presentInBranch(branchId, now()),
        eq(attendanceSessions.employeeId, employeeId),
      )!).limit(1))[0] ?? null;
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
