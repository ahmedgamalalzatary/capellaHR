import {
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceSessions,
  employeeEmploymentPeriods,
  employees,
} from '@capella/database/schema';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

import { employmentDateIsActive } from '../employees/employment-period.js';
import type { PayrollAttendanceGateway } from '../payroll/index.js';
import { calendarDateInTimeZone } from '../weekly-day-off/index.js';
import { endOfDate, startOfDate } from './attendance-calendar.js';
import type { Executor } from './attendance-repository-support.js';

export const createAttendancePayrollGateway = (
  options: { now: () => Date; timeZone: string },
): PayrollAttendanceGateway => {
  const { now, timeZone } = options;

  return {
    async readPayrollFacts(employeeId, payrollMonth, context, mode) {
      const executor = context as Executor;
      const employee = (await executor.select({
        createdAt: employees.createdAt,
        deletedAt: employees.deletedAt,
      }).from(employees).where(eq(employees.id, employeeId)).limit(1))[0];
      if (!employee) return { kind: 'blocked', reasons: ['ATTENDANCE_EMPLOYEE_NOT_FOUND'] };
      const storedEmploymentPeriods = await executor.select({
        activeFrom: employeeEmploymentPeriods.activeFrom,
        activeTo: employeeEmploymentPeriods.activeTo,
      }).from(employeeEmploymentPeriods).where(eq(employeeEmploymentPeriods.employeeId, employeeId));
      const employmentPeriods = storedEmploymentPeriods.length
        ? storedEmploymentPeriods
        : [{ activeFrom: employee.createdAt, activeTo: employee.deletedAt }];

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
        withoutPermissionAt: attendanceDailyRecords.withoutPermissionAt,
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
      const currentDate = calendarDateInTimeZone(now(), timeZone);
      for (let day = 1; day <= daysInMonth; day += 1) {
        const attendanceDate = `${payrollMonth}-${String(day).padStart(2, '0')}`;
        if (attendanceDate < currentDate
          && employmentDateIsActive(attendanceDate, employmentPeriods, timeZone)
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
        // Required minutes stay single so the per-minute rate is untouched; only the
        // deducted side doubles, making an unpermitted absence cost exactly two days.
        requiredMinutes += record.requiredMinutes;
        shortageMinutes += record.requiredMinutes * (record.withoutPermissionAt === null ? 1 : 2);
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
  };
};
