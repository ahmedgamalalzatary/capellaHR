import type { DashboardSnapshotDto } from '@capella/contracts';
import {
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceSessions,
  branches,
  devicePairingRequests,
  employees,
  reportExports,
} from '@capella/database/schema';
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  lt,
  notExists,
  sql,
} from 'drizzle-orm';

import {
  calendarMonthInTimeZone,
} from '../payroll/index.js';
import { calendarDateInTimeZone } from '../weekly-day-off/index.js';
import { payrollBlockers } from './dashboard-payroll-blockers.js';
import {
  employeeFields,
  LIST_LIMIT,
  previousMonth,
  startOfDate,
  totalOf,
  type Database,
} from './dashboard-repository-helpers.js';
import type { DashboardRepository } from './dashboard-service.js';

export const createDrizzleDashboardRepository = (
  database: Database,
  options: {
    now?: () => Date;
    timeZone?: string;
  },
): DashboardRepository => {
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone ?? 'Africa/Cairo';
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(0));

  return {
    getSnapshot: () => database.transaction(async (transaction) => {
      const generatedAt = now();
      const cairoDate = calendarDateInTimeZone(generatedAt, timeZone);
      const payrollMonth = previousMonth(calendarMonthInTimeZone(generatedAt, timeZone));

      const currentCondition = and(
        eq(attendanceSessions.attendanceDate, cairoDate),
        isNull(attendanceSessions.checkOutAt),
        isNull(employees.deletedAt),
      );
      const currentRows = await transaction.select({
        ...employeeFields,
        sessionId: attendanceSessions.id,
        attendanceDate: attendanceSessions.attendanceDate,
        checkInAt: attendanceSessions.checkInAt,
      }).from(attendanceSessions)
        .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
        .innerJoin(branches, eq(branches.id, employees.branchId))
        .where(currentCondition).orderBy(asc(attendanceSessions.checkInAt)).limit(LIST_LIMIT);
      const currentTotal = await totalOf(transaction.select({ value: count() })
        .from(attendanceSessions).innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
        .where(currentCondition));

      const staleCondition = and(
        lt(attendanceSessions.attendanceDate, cairoDate),
        isNull(attendanceSessions.checkOutAt),
        isNull(employees.deletedAt),
      );
      const staleRows = await transaction.select({
        ...employeeFields,
        sessionId: attendanceSessions.id,
        attendanceDate: attendanceSessions.attendanceDate,
        checkInAt: attendanceSessions.checkInAt,
      }).from(attendanceSessions)
        .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
        .innerJoin(branches, eq(branches.id, employees.branchId))
        .where(staleCondition).orderBy(asc(attendanceSessions.checkInAt)).limit(LIST_LIMIT);
      const staleTotal = await totalOf(transaction.select({ value: count() })
        .from(attendanceSessions).innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
        .where(staleCondition));

      const noCurrentSession = notExists(transaction.select({ value: sql`1` })
        .from(attendanceSessions).where(and(
          eq(attendanceSessions.employeeId, employees.id),
          eq(attendanceSessions.attendanceDate, cairoDate),
        )));
      const noOpenSession = notExists(transaction.select({ value: sql`1` })
        .from(attendanceSessions).where(and(
          eq(attendanceSessions.employeeId, employees.id),
          isNull(attendanceSessions.checkOutAt),
        )));
      const notCheckedCondition = and(
        isNull(employees.deletedAt),
        eq(employees.employmentStatus, 'active'),
        lt(employees.createdAt, startOfDate(cairoDate, timeZone)),
        noCurrentSession,
        noOpenSession,
      );
      const notCheckedRows = await transaction.select(employeeFields).from(employees)
        .innerJoin(branches, eq(branches.id, employees.branchId))
        .where(notCheckedCondition).orderBy(asc(employees.employeeCode)).limit(LIST_LIMIT);
      const notCheckedTotal = await totalOf(transaction.select({ value: count() }).from(employees)
        .where(notCheckedCondition));

      const dailyRows = await transaction.select({
        ...employeeFields,
        id: attendanceDailyRecords.id,
        attendanceDate: attendanceDailyRecords.attendanceDate,
        status: attendanceDailyRecords.status,
        createdAt: attendanceDailyRecords.createdAt,
        updatedAt: attendanceDailyRecords.updatedAt,
        dayOffConvertedAt: attendanceDailyRecords.dayOffConvertedAt,
      }).from(attendanceDailyRecords)
        .innerJoin(employees, eq(employees.id, attendanceDailyRecords.employeeId))
        .innerJoin(branches, eq(branches.id, employees.branchId))
        .where(and(
          isNull(employees.deletedAt),
          sql`${attendanceDailyRecords.status} in ('absence', 'weekly_day_off')`,
        ))
        .orderBy(desc(sql`coalesce(${attendanceDailyRecords.dayOffConvertedAt}, ${attendanceDailyRecords.updatedAt})`))
        .limit(LIST_LIMIT);

      const reviewCondition = and(
        isNull(attendanceDeniedAttempts.approvedAt),
        isNull(attendanceDeniedAttempts.dismissedAt),
      );
      const reviewRows = await transaction.select({
        id: attendanceDeniedAttempts.id,
        claimedEmployeeCode: attendanceDeniedAttempts.claimedEmployeeCode,
        employeeId: attendanceDeniedAttempts.employeeId,
        employeeName: employees.fullName,
        eventType: attendanceDeniedAttempts.eventType,
        source: attendanceDeniedAttempts.source,
        failureReason: attendanceDeniedAttempts.failureReason,
        suspicious: attendanceDeniedAttempts.suspicious,
        occurredAt: attendanceDeniedAttempts.occurredAt,
      }).from(attendanceDeniedAttempts)
        .leftJoin(employees, eq(employees.id, attendanceDeniedAttempts.employeeId))
        .where(reviewCondition).orderBy(desc(attendanceDeniedAttempts.occurredAt)).limit(LIST_LIMIT);
      const reviewTotals = (await transaction.select({
        unresolvedTotal: count(),
        flaggedTotal: sql<number>`sum(case when ${attendanceDeniedAttempts.suspicious} then 1 else 0 end)`.mapWith(Number),
      }).from(attendanceDeniedAttempts).where(reviewCondition))[0];

      const timeoutCondition = and(
        sql`${attendanceSessions.automaticTimeoutAt} is not null`,
        isNull(employees.deletedAt),
      );
      const timeoutRows = await transaction.select({
        ...employeeFields,
        sessionId: attendanceSessions.id,
        attendanceDate: attendanceSessions.attendanceDate,
        checkInAt: attendanceSessions.checkInAt,
        automaticTimeoutAt: attendanceSessions.automaticTimeoutAt,
        correctedAt: attendanceSessions.automaticTimeoutCorrectedAt,
      }).from(attendanceSessions)
        .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
        .innerJoin(branches, eq(branches.id, employees.branchId))
        .where(timeoutCondition).orderBy(desc(attendanceSessions.automaticTimeoutAt)).limit(LIST_LIMIT);
      const timeoutTotal = await totalOf(transaction.select({ value: count() })
        .from(attendanceSessions).innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
        .where(timeoutCondition));

      const activeDeviceExists = () => sql<number>`(
        (${devicePairingRequests.assignmentType} = 'employee' and exists (
          select 1 from devices active_employee_device
          where active_employee_device.status = 'active'
            and active_employee_device.assignment_type = 'employee'
            and active_employee_device.employee_id = ${devicePairingRequests.employeeId}
        ))
        or
        (${devicePairingRequests.assignmentType} = 'branch' and exists (
          select 1 from devices active_branch_device
          where active_branch_device.status = 'active'
            and active_branch_device.assignment_type = 'branch'
            and active_branch_device.branch_id = ${devicePairingRequests.branchId}
        ))
      )`;
      const pendingRows = await transaction.select({
        id: devicePairingRequests.id,
        assignmentType: devicePairingRequests.assignmentType,
        employeeId: devicePairingRequests.employeeId,
        employeeName: employees.fullName,
        branchId: devicePairingRequests.branchId,
        branchName: branches.name,
        hasActiveDevice: activeDeviceExists().mapWith(Number),
        createdAt: devicePairingRequests.createdAt,
      }).from(devicePairingRequests)
        .leftJoin(employees, eq(employees.id, devicePairingRequests.employeeId))
        .leftJoin(branches, eq(branches.id, devicePairingRequests.branchId))
        .where(eq(devicePairingRequests.status, 'pending'))
        .orderBy(desc(devicePairingRequests.createdAt), desc(devicePairingRequests.id))
        .limit(LIST_LIMIT);
      const pendingTotal = await totalOf(transaction.select({ value: count() })
        .from(devicePairingRequests).where(eq(devicePairingRequests.status, 'pending')));
      const replacementTotal = await totalOf(transaction.select({ value: count() })
        .from(devicePairingRequests)
        .where(and(eq(devicePairingRequests.status, 'pending'), activeDeviceExists())));
      const pairingItems = pendingRows.map((pairing) => {
        const assignmentId = pairing.assignmentType === 'employee' ? pairing.employeeId! : pairing.branchId!;
        return {
          id: pairing.id,
          kind: pairing.hasActiveDevice ? 'replacement' as const : 'pairing' as const,
          assignmentType: pairing.assignmentType,
          assignmentId,
          assignmentName: (pairing.assignmentType === 'employee'
            ? pairing.employeeName
            : pairing.branchName) ?? `#${assignmentId}`,
          createdAt: pairing.createdAt.toISOString(),
        };
      });

      const exportCounts = { queued: 0, processing: 0, completed: 0, failed: 0 };
      const groupedExports = await transaction.select({
        status: reportExports.status,
        value: count(),
      }).from(reportExports).groupBy(reportExports.status);
      for (const group of groupedExports) exportCounts[group.status] = Number(group.value);
      const exportRows = await transaction.select({
        id: reportExports.id,
        reportType: reportExports.reportType,
        status: reportExports.status,
        attemptCount: reportExports.attemptCount,
        retryCount: reportExports.retryCount,
        failureReason: reportExports.failureReason,
        queuedAt: reportExports.queuedAt,
        updatedAt: reportExports.updatedAt,
      }).from(reportExports).orderBy(desc(reportExports.updatedAt), desc(reportExports.id)).limit(LIST_LIMIT);

      const blockers = await payrollBlockers(
        transaction,
        payrollMonth,
        timeZone,
        cairoDate,
      );

      const attendanceItem = (row: typeof currentRows[number]) => ({
        ...row,
        checkInAt: row.checkInAt.toISOString(),
      });
      return {
        generatedAt: generatedAt.toISOString(),
        cairoDate,
        payrollMonth,
        currentlyCheckedIn: { total: currentTotal, items: currentRows.map(attendanceItem) },
        previousDayOpen: { total: staleTotal, items: staleRows.map(attendanceItem) },
        notCheckedIn: { total: notCheckedTotal, items: notCheckedRows },
        latestDailyRecords: {
          items: dailyRows.map(({ createdAt, updatedAt, dayOffConvertedAt, status, ...row }) => ({
            ...row,
            status: status as 'absence' | 'weekly_day_off',
            occurredAt: (dayOffConvertedAt ?? updatedAt ?? createdAt).toISOString(),
          })),
        },
        attendanceReview: {
          unresolvedTotal: Number(reviewTotals?.unresolvedTotal ?? 0),
          flaggedTotal: Number(reviewTotals?.flaggedTotal ?? 0),
          items: reviewRows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
        },
        automaticTimeouts: {
          total: timeoutTotal,
          items: timeoutRows.map((row) => ({
            ...row,
            checkInAt: row.checkInAt.toISOString(),
            automaticTimeoutAt: row.automaticTimeoutAt!.toISOString(),
            correctedAt: row.correctedAt?.toISOString() ?? null,
          })),
        },
        devicePairings: {
          pendingTotal,
          replacementTotal,
          items: pairingItems,
        },
        payrollBlockers: blockers,
        pdfExports: {
          ...exportCounts,
          items: exportRows.map((row) => ({
            ...row,
            queuedAt: row.queuedAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })),
        },
      } satisfies DashboardSnapshotDto;
    }),
  };
};
