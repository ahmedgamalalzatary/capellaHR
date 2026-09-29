import { type createDatabase } from '@capella/database';
import {
  attendanceDailyRecords,
  employeeSalaryPeriods,
  employees,
  financialAuditEvents,
  payrollMonths,
} from '@capella/database/schema';
import { and, desc, eq, gte, lte } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import {
  bonusDaysAmount,
  calendarMonthInTimeZone,
  fullMonthWorkdaysFor,
  monthEnd,
  payrollMonthStart,
} from './payroll-domain.js';

export type Database = ReturnType<typeof createDatabase>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

export const createFinancialContext = (
  now: () => Date = () => new Date(),
  timeZone = 'Africa/Cairo',
) => ({
  now,
  currentMonth: () => calendarMonthInTimeZone(now(), timeZone),
});

export const lockEmployee = async (transaction: Transaction, employeeId: number) => (
  await transaction.select({
    id: employees.id,
    employeeCode: employees.employeeCode,
    fullName: employees.fullName,
    branchId: employees.branchId,
    monthlyBaseSalary: employees.monthlyBaseSalary,
    employmentStatus: employees.employmentStatus,
    createdAt: employees.createdAt,
    deletedAt: employees.deletedAt,
  }).from(employees).where(eq(employees.id, employeeId)).for('update').limit(1)
)[0] ?? null;

/**
 * Resolves a day count into money for the employee it is for. The rate is the salary
 * that applied in that month over that month's workday count, so the figure the employee
 * sees is derived the same way their prorated base is rather than typed in by hand.
 */
export const resolveAdjustmentAmount = async (
  executor: Executor,
  employee: { id: number; monthlyBaseSalary: string },
  input: { amount?: string | undefined; days?: number | undefined; payrollMonth: string },
) => {
  if (input.amount !== undefined) {
    return { amount: input.amount, days: null as number | null, baseSalarySnapshot: null as string | null };
  }
  if (input.days === undefined) throw new Error('Either amount or days is required');
  const days = input.days;
  const month = payrollMonthStart(input.payrollMonth);
  const [salary, daysOff] = await Promise.all([
    executor.select({ baseSalary: employeeSalaryPeriods.baseSalary }).from(employeeSalaryPeriods)
      .where(and(
        eq(employeeSalaryPeriods.employeeId, employee.id),
        lte(employeeSalaryPeriods.effectiveMonth, month),
      )).orderBy(desc(employeeSalaryPeriods.effectiveMonth)).limit(1),
    executor.select({ attendanceDate: attendanceDailyRecords.attendanceDate })
      .from(attendanceDailyRecords).where(and(
        eq(attendanceDailyRecords.employeeId, employee.id),
        eq(attendanceDailyRecords.status, 'weekly_day_off'),
        gte(attendanceDailyRecords.attendanceDate, month),
        lte(attendanceDailyRecords.attendanceDate, monthEnd(input.payrollMonth)),
      )),
  ]);
  const baseSalary = salary[0]?.baseSalary ?? employee.monthlyBaseSalary;
  const workdays = fullMonthWorkdaysFor({
    payrollMonth: input.payrollMonth,
    weeklyDaysOff: daysOff.map(({ attendanceDate }) => attendanceDate),
  });
  return {
    amount: bonusDaysAmount({ days, baseSalary, fullMonthWorkdays: workdays }),
    days,
    baseSalarySnapshot: baseSalary,
  };
};

export const isFinalized = async (
  executor: Executor,
  employeeId: number,
  month: string,
) => Boolean((await executor.select({ id: payrollMonths.id }).from(payrollMonths).where(and(
  eq(payrollMonths.employeeId, employeeId),
  eq(payrollMonths.payrollMonth, payrollMonthStart(month)),
)).limit(1))[0]);

export const writeFinancialAudit = async (
  transaction: Transaction,
  event: {
    entityType: 'salary' | 'payroll' | 'bonus' | 'deduction' | 'advance';
    entityId: number;
    action: 'create' | 'update' | 'delete' | 'finalize' | 'accelerate';
    beforeState?: unknown;
    afterState?: unknown;
    createdAt: Date;
  },
) => {
  await transaction.insert(financialAuditEvents).values({
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    beforeState: event.beforeState ?? null,
    afterState: event.afterState ?? null,
    createdAt: event.createdAt,
  });
  const state = (event.afterState ?? event.beforeState) as Record<string, unknown> | undefined;
  const employeeId = typeof state?.employeeId === 'number' ? state.employeeId : undefined;
  const module = event.entityType === 'bonus' ? 'bonuses'
    : event.entityType === 'deduction' ? 'deductions'
      : event.entityType === 'advance' ? 'advances' : 'payroll';
  await writeAudit(transaction, {
    module,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    beforeState: event.beforeState,
    afterState: event.afterState,
    ...(employeeId === undefined ? {} : { relatedIds: { employeeId } }),
    createdAt: event.createdAt,
  });
};
