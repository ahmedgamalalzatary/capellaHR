import {
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceSessions,
  employeeEmploymentPeriods,
  employees,
} from '@capella/database/schema';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

import { employmentDateAccruesAbsence } from '../employees/employment-period.js';
import type { PayrollAttendanceGateway } from '../payroll/index.js';
import { calendarDateInTimeZone } from '../weekly-day-off/index.js';
import { endOfDate, startOfDate } from './attendance-calendar.js';
import type { AttendanceRequiredDurationReader, Transaction } from './attendance-repository-support.js';
import type { AttendanceSessionWriter } from './attendance-session-writer.js';

export const createAttendancePayrollGateway = (
  options: {
    now: () => Date;
    timeZone: string;
    readRequiredDuration: AttendanceRequiredDurationReader;
    writer: AttendanceSessionWriter;
  },
): PayrollAttendanceGateway => {
  const { now, timeZone, readRequiredDuration, writer } = options;

  return {
    async readPayrollFacts(employeeId, payrollMonth, context, mode) {
      const executor = context as Transaction;
      const at = now();
      const currentDate = calendarDateInTimeZone(at, timeZone);
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
        checkInAt: attendanceSessions.checkInAt,
        checkOutAt: attendanceSessions.checkOutAt,
        workedMinutes: attendanceSessions.workedMinutes,
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
      const missingDates: string[] = [];
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
      for (let day = 1; day <= daysInMonth; day += 1) {
        const attendanceDate = `${payrollMonth}-${String(day).padStart(2, '0')}`;
        if (attendanceDate < currentDate
          && employmentDateAccruesAbsence(attendanceDate, employmentPeriods, timeZone)
          && !sessionByDate.has(attendanceDate) && !dailyByDate.has(attendanceDate)) {
          missingDates.push(attendanceDate);
        }
      }
      if (reasons.length) return { kind: 'blocked', reasons };

      const defaultRequiredMinutes = await readRequiredDuration(employeeId, executor, employee.deletedAt !== null);
      // Previews infer ordinary absences without writing. Approval records them in the
      // same transaction as payroll, using the existing audited attendance writer.
      for (const attendanceDate of missingDates) {
        if (mode === 'finalize') {
          await writer.createAbsenceForEmployee(executor, employeeId, attendanceDate);
        }
        const record = {
          attendanceDate, status: 'absence' as const,
          requiredMinutes: defaultRequiredMinutes, withoutPermissionAt: null,
        };
        dailyRecords.push(record);
        dailyByDate.set(attendanceDate, record);
      }

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
      const asOfDate = currentDate < monthEnd ? currentDate : monthEnd;
      let monthRequiredMinutes = 0;
      let requiredMinutesThroughDate = 0;
      let workedMinutes = 0;
      let absenceDaysWithPermission = 0;
      let absenceDaysWithoutPermission = 0;
      let weeklyDayOffDays = 0;
      let provisional = false;
      for (let day = 1; day <= daysInMonth; day += 1) {
        const attendanceDate = `${payrollMonth}-${String(day).padStart(2, '0')}`;
        const session = sessionByDate.get(attendanceDate);
        const daily = dailyByDate.get(attendanceDate);
        if (!session && !employmentDateAccruesAbsence(attendanceDate, employmentPeriods, timeZone)) continue;
        const dailyRequired = session?.requiredMinutes
          ?? (daily?.status === 'absence' ? daily.requiredMinutes
            : daily?.status === 'weekly_day_off' ? 0 : defaultRequiredMinutes);
        monthRequiredMinutes += dailyRequired;
        if (attendanceDate > asOfDate) continue;
        requiredMinutesThroughDate += dailyRequired;
        if (session) {
          if (session.checkOutAt !== null) workedMinutes += session.workedMinutes ?? 0;
          else {
            // Match automatic checkout's sixteen-hour limit even when its worker is delayed.
            const through = Math.min(at.getTime(), session.checkInAt.getTime() + 16 * 60 * 60_000);
            workedMinutes += Math.max(0, Math.floor((through - session.checkInAt.getTime()) / 60_000));
            provisional = true;
          }
        } else if (daily?.status === 'absence') {
          if (daily.withoutPermissionAt === null) absenceDaysWithPermission += 1;
          else absenceDaysWithoutPermission += 1;
        } else if (daily?.status === 'weekly_day_off') weeklyDayOffDays += 1;
      }
      return {
        kind: 'ready',
        facts: {
          fullMonthWorkdays: daysInMonth - weeklyDays.size,
          eligibleWorkdays,
          requiredMinutes,
          overtimeMinutes,
          shortageMinutes,
          attendanceSummary: {
            monthRequiredMinutes, requiredMinutesThroughDate, workedMinutes,
            actualShortageMinutes: Math.max(0, requiredMinutesThroughDate - workedMinutes),
            actualOvertimeMinutes: Math.max(0, workedMinutes - requiredMinutesThroughDate),
            absenceDaysWithPermission, absenceDaysWithoutPermission, weeklyDayOffDays,
            asOfDate, provisional,
          },
        },
      };
    },
  };
};
