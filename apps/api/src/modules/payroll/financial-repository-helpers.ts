import { type createDatabase } from '@capella/database';
import {
  employees,
  financialAuditEvents,
  payrollMonths,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import { calendarMonthInTimeZone, payrollMonthStart } from './payroll-domain.js';

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
    createdAt: employees.createdAt,
    deletedAt: employees.deletedAt,
  }).from(employees).where(eq(employees.id, employeeId)).for('update').limit(1)
)[0] ?? null;

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
