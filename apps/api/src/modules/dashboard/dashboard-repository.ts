import type { DashboardSnapshotDto } from '@capella/contracts';
import type { createDatabase } from '@capella/database';
import {
  advanceInstallments,
  attendanceDailyRecords,
  attendanceDeniedAttempts,
  attendanceSessions,
  bonuses,
  branches,
  deductions,
  devicePairingRequests,
  devices,
  employeeSalaryPeriods,
  employees,
  payrollMonths,
  reportExports,
} from '@capella/database/schema';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  sql,
} from 'drizzle-orm';

import {
  calculatePayroll,
  calendarMonthInTimeZone,
  isPayrollSnapshotAmount,
  payrollMonthStart,
} from '../payroll/index.js';
import { calendarDateInTimeZone } from '../weekly-day-off/index.js';
import type { DashboardRepository } from './dashboard-service.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const LIST_LIMIT = 5;
const employeeFields = {
  employeeId: employees.id,
  employeeCode: employees.employeeCode,
  employeeName: employees.fullName,
  branchId: branches.id,
  branchName: branches.name,
};

const previousMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const previous = monthNumber === 1 ? [year - 1, 12] : [year, monthNumber - 1];
  return `${previous[0]}-${String(previous[1]).padStart(2, '0')}`;
};

const nextMonth = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const next = monthNumber === 12 ? [year + 1, 1] : [year, monthNumber + 1];
  return `${next[0]}-${String(next[1]).padStart(2, '0')}`;
};

const startOfDate = (value: string, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(year, month - 1, day);
  let low = target - 36 * 60 * 60 * 1000;
  let high = target + 36 * 60 * 60 * 1000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const parts = Object.fromEntries(formatter.formatToParts(new Date(middle))
      .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (date < value) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
};

const totalOf = async (query: Promise<Array<{ value: number }>>) => Number((await query)[0]?.value ?? 0);

const payrollBlockers = async (
  transaction: Transaction,
  month: string,
  timeZone: string,
  currentDate: string,
) => {
  const candidates = await transaction.select({
    ...employeeFields,
    monthlyBaseSalary: employees.monthlyBaseSalary,
    createdAt: employees.createdAt,
    deletedAt: employees.deletedAt,
  }).from(employees).innerJoin(branches, eq(branches.id, employees.branchId))
    .orderBy(asc(employees.employeeCode));
  const finalized = await transaction.select({
    employeeId: payrollMonths.employeeId,
    payrollMonth: payrollMonths.payrollMonth,
    netSalary: payrollMonths.netSalary,
  }).from(payrollMonths);
  const finalizedKeys = new Set(finalized.map((row) => `${row.employeeId}:${row.payrollMonth.slice(0, 7)}`));
  const eligible = candidates.filter((employee) => {
    const creationMonth = calendarMonthInTimeZone(employee.createdAt, timeZone);
    const deletionMonth = employee.deletedAt
      ? calendarMonthInTimeZone(employee.deletedAt, timeZone)
      : null;
    return creationMonth <= month && (deletionMonth === null || deletionMonth >= month);
  }).filter((employee) => !finalizedKeys.has(`${employee.employeeId}:${month}`));
  if (!eligible.length) return { total: 0, items: [] };

  const employeeIds = eligible.map(({ employeeId }) => employeeId);
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const monthEnd = `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`;
  const deniedStart = startOfDate(monthStart, timeZone);
  const deniedEnd = new Date(startOfDate(`${nextMonth(month)}-01`, timeZone).getTime() - 1);

  const sessions = await transaction.select({
    employeeId: attendanceSessions.employeeId,
    attendanceDate: attendanceSessions.attendanceDate,
    requiredMinutes: attendanceSessions.requiredMinutes,
    checkInAt: attendanceSessions.checkInAt,
    checkOutAt: attendanceSessions.checkOutAt,
    overtimeMinutes: attendanceSessions.overtimeMinutes,
    shortageMinutes: attendanceSessions.shortageMinutes,
  }).from(attendanceSessions).where(and(
    inArray(attendanceSessions.employeeId, employeeIds),
    gte(attendanceSessions.attendanceDate, monthStart),
    lte(attendanceSessions.attendanceDate, monthEnd),
  ));
  const dailyRecords = await transaction.select({
    employeeId: attendanceDailyRecords.employeeId,
    attendanceDate: attendanceDailyRecords.attendanceDate,
    status: attendanceDailyRecords.status,
    requiredMinutes: attendanceDailyRecords.absenceRequiredMinutes,
  }).from(attendanceDailyRecords).where(and(
    inArray(attendanceDailyRecords.employeeId, employeeIds),
    gte(attendanceDailyRecords.attendanceDate, monthStart),
    lte(attendanceDailyRecords.attendanceDate, monthEnd),
  ));
  const pendingDenied = await transaction.select({
    employeeId: attendanceDeniedAttempts.employeeId,
    eventType: attendanceDeniedAttempts.eventType,
    occurredAt: attendanceDeniedAttempts.occurredAt,
  }).from(attendanceDeniedAttempts).where(and(
    inArray(attendanceDeniedAttempts.employeeId, employeeIds),
    isNull(attendanceDeniedAttempts.approvedAt),
    isNull(attendanceDeniedAttempts.dismissedAt),
    gte(attendanceDeniedAttempts.occurredAt, deniedStart),
    lte(attendanceDeniedAttempts.occurredAt, deniedEnd),
  ));
  const openSessions = await transaction.select({
    employeeId: attendanceSessions.openEmployeeId,
    checkInAt: attendanceSessions.checkInAt,
  }).from(attendanceSessions).where(inArray(attendanceSessions.openEmployeeId, employeeIds));
  const salaryPeriods = await transaction.select({
    employeeId: employeeSalaryPeriods.employeeId,
    effectiveMonth: employeeSalaryPeriods.effectiveMonth,
    amount: employeeSalaryPeriods.baseSalary,
  }).from(employeeSalaryPeriods).where(and(
    inArray(employeeSalaryPeriods.employeeId, employeeIds),
    lte(employeeSalaryPeriods.effectiveMonth, payrollMonthStart(month)),
  )).orderBy(desc(employeeSalaryPeriods.effectiveMonth));
  const bonusRows = await transaction.select({
    employeeId: bonuses.employeeId,
    amount: sql<string>`coalesce(sum(${bonuses.amount}), 0.00)`,
  }).from(bonuses).where(and(
    inArray(bonuses.employeeId, employeeIds),
    eq(bonuses.payrollMonth, payrollMonthStart(month)),
  )).groupBy(bonuses.employeeId);
  const deductionRows = await transaction.select({
    employeeId: deductions.employeeId,
    amount: sql<string>`coalesce(sum(${deductions.amount}), 0.00)`,
  }).from(deductions).where(and(
    inArray(deductions.employeeId, employeeIds),
    eq(deductions.payrollMonth, payrollMonthStart(month)),
  )).groupBy(deductions.employeeId);
  const advanceRows = await transaction.select({
    employeeId: advanceInstallments.employeeId,
    amount: sql<string>`coalesce(sum(${advanceInstallments.amount}), 0.00)`,
  }).from(advanceInstallments).where(and(
    inArray(advanceInstallments.employeeId, employeeIds),
    eq(advanceInstallments.payrollMonth, payrollMonthStart(month)),
  )).groupBy(advanceInstallments.employeeId);

  const grouped = <T extends { employeeId: number }>(rows: T[]) => {
    const result = new Map<number, T[]>();
    for (const row of rows) result.set(row.employeeId, [...(result.get(row.employeeId) ?? []), row]);
    return result;
  };
  const sessionsByEmployee = grouped(sessions);
  const dailyByEmployee = grouped(dailyRecords);
  const deniedByEmployee = grouped(pendingDenied.flatMap((row) => row.employeeId === null ? [] : [{ ...row, employeeId: row.employeeId }]));
  const openByEmployee = new Map(openSessions.flatMap((row) => row.employeeId === null ? [] : [[row.employeeId, row]]));
  const salaryByEmployee = new Map<number, string>();
  for (const row of salaryPeriods) if (!salaryByEmployee.has(row.employeeId)) salaryByEmployee.set(row.employeeId, row.amount);
  const amountMap = (rows: Array<{ employeeId: number; amount: string }>) => new Map(rows.map((row) => [row.employeeId, row.amount]));
  const bonusesByEmployee = amountMap(bonusRows);
  const deductionsByEmployee = amountMap(deductionRows);
  const advancesByEmployee = amountMap(advanceRows);
  const carryByEmployee = new Map<number, { month: string; amount: string }>();
  for (const row of finalized) {
    const payrollMonth = row.payrollMonth.slice(0, 7);
    const prior = carryByEmployee.get(row.employeeId);
    if (payrollMonth < month && (!prior || payrollMonth > prior.month)) {
      carryByEmployee.set(row.employeeId, { month: payrollMonth, amount: row.netSalary.startsWith('-') ? row.netSalary : '0.00' });
    }
  }

  const blockers: DashboardSnapshotDto['payrollBlockers']['items'] = [];
  for (const employee of eligible) {
    const reasons = new Set<string>();
    for (
      let cursor = calendarMonthInTimeZone(employee.createdAt, timeZone);
      cursor < month;
      cursor = nextMonth(cursor)
    ) {
      if (!finalizedKeys.has(`${employee.employeeId}:${cursor}`)) {
        reasons.add('PAYROLL_CHRONOLOGY_CONFLICT');
        break;
      }
    }

    const employeeSessions = sessionsByEmployee.get(employee.employeeId) ?? [];
    const employeeDaily = dailyByEmployee.get(employee.employeeId) ?? [];
    const employeeDenied = deniedByEmployee.get(employee.employeeId) ?? [];
    const sessionByDate = new Map(employeeSessions.map((session) => [session.attendanceDate, session]));
    const dailyByDate = new Map(employeeDaily.map((record) => [record.attendanceDate, record]));
    if (employeeSessions.some(({ checkOutAt }) => checkOutAt === null)) reasons.add('OPEN_SESSION');
    if (employeeDenied.some((attempt) => {
      if (attempt.eventType === 'check_out') {
        const open = openByEmployee.get(employee.employeeId);
        return open !== undefined && attempt.occurredAt.getTime() > open.checkInAt.getTime();
      }
      const attendanceDate = calendarDateInTimeZone(attempt.occurredAt, timeZone);
      return !sessionByDate.has(attendanceDate)
        && dailyByDate.get(attendanceDate)?.status !== 'weekly_day_off';
    })) reasons.add('DENIED_ATTEMPT');

    const creationDate = calendarDateInTimeZone(employee.createdAt, timeZone);
    const deletionDate = employee.deletedAt ? calendarDateInTimeZone(employee.deletedAt, timeZone) : null;
    for (let day = 1; day <= Number(monthEnd.slice(-2)); day += 1) {
      const attendanceDate = `${month}-${String(day).padStart(2, '0')}`;
      const employmentInterior = attendanceDate > creationDate
        && (deletionDate === null || attendanceDate < deletionDate);
      if (attendanceDate < currentDate && employmentInterior
        && !sessionByDate.has(attendanceDate) && !dailyByDate.has(attendanceDate)) {
        reasons.add('ATTENDANCE_RECONCILIATION_PENDING');
        break;
      }
    }

    if (!reasons.size) {
      const weeklyDays = new Set(employeeDaily
        .filter(({ status }) => status === 'weekly_day_off')
        .map(({ attendanceDate }) => attendanceDate));
      const facts = {
        fullMonthWorkdays: Number(monthEnd.slice(-2)) - weeklyDays.size,
        eligibleWorkdays: employeeSessions.length + employeeDaily.filter(({ status }) => status === 'absence').length,
        requiredMinutes: employeeSessions.reduce((total, row) => total + row.requiredMinutes, 0)
          + employeeDaily.filter(({ status }) => status === 'absence')
            .reduce((total, row) => total + row.requiredMinutes, 0),
        overtimeMinutes: employeeSessions.reduce((total, row) => total + (row.overtimeMinutes ?? 0), 0),
        shortageMinutes: employeeSessions.reduce((total, row) => total + (row.shortageMinutes ?? 0), 0)
          + employeeDaily.filter(({ status }) => status === 'absence')
            .reduce((total, row) => total + row.requiredMinutes, 0),
      };
      const baseSalary = salaryByEmployee.get(employee.employeeId) ?? employee.monthlyBaseSalary;
      const bonusAmount = bonusesByEmployee.get(employee.employeeId) ?? '0.00';
      const manualDeductionAmount = deductionsByEmployee.get(employee.employeeId) ?? '0.00';
      const advanceAmount = advancesByEmployee.get(employee.employeeId) ?? '0.00';
      const carry = carryByEmployee.get(employee.employeeId)?.amount ?? '0.00';
      const calculated = calculatePayroll({
        baseSalary,
        ...facts,
        bonuses: bonusAmount,
        deductions: manualDeductionAmount,
        advances: advanceAmount,
        priorNegativeCarry: carry,
      });
      if (![baseSalary, calculated.proratedBase, calculated.overtimeAmount, bonusAmount,
        calculated.attendanceDeductionAmount, manualDeductionAmount, advanceAmount, carry,
        calculated.netSalary].every(isPayrollSnapshotAmount)) reasons.add('PAYROLL_AMOUNT_OUT_OF_RANGE');
    }
    if (reasons.size) blockers.push({
      employeeId: employee.employeeId,
      employeeCode: employee.employeeCode,
      employeeName: employee.employeeName,
      branchId: employee.branchId,
      branchName: employee.branchName,
      reasons: [...reasons],
    });
  }
  return { total: blockers.length, items: blockers.slice(0, LIST_LIMIT) };
};

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

      const pendingRows = await transaction.select({
        id: devicePairingRequests.id,
        assignmentType: devicePairingRequests.assignmentType,
        employeeId: devicePairingRequests.employeeId,
        employeeName: employees.fullName,
        branchId: devicePairingRequests.branchId,
        branchName: branches.name,
        registrationChallenge: devicePairingRequests.registrationChallenge,
        createdAt: devicePairingRequests.createdAt,
      }).from(devicePairingRequests)
        .leftJoin(employees, eq(employees.id, devicePairingRequests.employeeId))
        .leftJoin(branches, eq(branches.id, devicePairingRequests.branchId))
        .where(eq(devicePairingRequests.status, 'pending'))
        .orderBy(desc(devicePairingRequests.createdAt));
      const activeAssignments = await transaction.select({
        assignmentType: devices.assignmentType,
        employeeId: devices.employeeId,
        branchId: devices.branchId,
      }).from(devices).where(eq(devices.status, 'active'));
      const activeKeys = new Set(activeAssignments.map((device) => `${device.assignmentType}:${
        device.assignmentType === 'employee' ? device.employeeId : device.branchId
      }`));
      const pairingItems = [] as DashboardSnapshotDto['devicePairings']['items'];
      let replacementTotal = 0;
      for (const pairing of pendingRows) {
        const assignmentId = pairing.assignmentType === 'employee' ? pairing.employeeId! : pairing.branchId!;
        const kind = activeKeys.has(`${pairing.assignmentType}:${assignmentId}`)
          ? 'replacement' as const : 'pairing' as const;
        if (kind === 'replacement') replacementTotal += 1;
        if (pairingItems.length < LIST_LIMIT) pairingItems.push({
          id: pairing.id,
          kind,
          assignmentType: pairing.assignmentType,
          assignmentId,
          assignmentName: (pairing.assignmentType === 'employee'
            ? pairing.employeeName
            : pairing.branchName) ?? `#${assignmentId}`,
          optionsIssued: pairing.registrationChallenge !== null,
          createdAt: pairing.createdAt.toISOString(),
        });
      }

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
          pendingTotal: pendingRows.length,
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
