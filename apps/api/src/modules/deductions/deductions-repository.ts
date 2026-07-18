import type { ListDeductionsQuery } from '@capella/contracts';
import { branches, deductions, employees } from '@capella/database/schema';
import { and, asc, count, eq, or, sql } from 'drizzle-orm';

import {
  createFinancialContext,
  type Database,
  type Executor,
  isFinalized,
  lockEmployee,
  writeFinancialAudit,
} from '../payroll/financial-repository-helpers.js';
import { calendarMonthInTimeZone, payrollMonthStart } from '../payroll/payroll-domain.js';
import type { DeductionRecord, DeductionRepository } from './deductions-service.js';

const fields = {
  id: deductions.id, employeeId: deductions.employeeId, employeeCode: employees.employeeCode,
  employeeName: employees.fullName, branchId: employees.branchId, branchName: branches.name,
  payrollMonth: deductions.payrollMonth, amount: deductions.amount, employeeDeletedAt: employees.deletedAt,
  createdAt: deductions.createdAt, updatedAt: deductions.updatedAt,
};
const rawFind = async (executor: Executor, id: number) => (
  await executor.select(fields).from(deductions)
    .innerJoin(employees, eq(employees.id, deductions.employeeId))
    .innerJoin(branches, eq(branches.id, employees.branchId))
    .where(eq(deductions.id, id)).limit(1)
)[0] ?? null;
const expose = (record: Awaited<ReturnType<typeof rawFind>>): DeductionRecord | null => record
  ? { ...record, payrollMonth: record.payrollMonth.slice(0, 7) } : null;
const findRecord = async (executor: Executor, id: number) => expose(await rawFind(executor, id));

export const createDrizzleDeductionRepository = (
  database: Database,
  options: { now?: () => Date; timeZone?: string } = {},
): DeductionRepository => {
  const context = createFinancialContext(options.now, options.timeZone);
  const timeZone = options.timeZone ?? 'Africa/Cairo';
  return {
    create(input) {
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, input.employeeId);
        if (!employee) return { kind: 'employee_not_found' as const };
        if (employee.deletedAt) return { kind: 'employee_deleted' as const };
        if (input.payrollMonth < calendarMonthInTimeZone(employee.createdAt, timeZone)) return { kind: 'ineligible_month' as const };
        if (input.payrollMonth > context.currentMonth()) return { kind: 'future_month' as const };
        if (await isFinalized(transaction, input.employeeId, input.payrollMonth)) return { kind: 'finalized' as const };
        const at = context.now();
        const inserted = await transaction.insert(deductions).values({
          employeeId: input.employeeId, payrollMonth: payrollMonthStart(input.payrollMonth),
          amount: input.amount, createdAt: at, updatedAt: at,
        });
        const id = Number(inserted[0].insertId);
        const record = (await findRecord(transaction, id))!;
        await writeFinancialAudit(transaction, { entityType: 'deduction', entityId: id, action: 'create', afterState: record, createdAt: at });
        return { kind: 'success' as const, record };
      });
    },
    findById(id) { return findRecord(database, id); },
    async list(query: ListDeductionsQuery) {
      const filters = [];
      if (query.employeeId !== undefined) filters.push(eq(deductions.employeeId, query.employeeId));
      if (query.branchId !== undefined) filters.push(eq(employees.branchId, query.branchId));
      if (query.payrollMonth !== undefined) filters.push(eq(deductions.payrollMonth, payrollMonthStart(query.payrollMonth)));
      if (query.search !== undefined) filters.push(or(
        sql`locate(${query.search}, ${employees.fullName}) > 0`,
        sql`locate(${query.search}, cast(${employees.employeeCode} as char)) > 0`,
      )!);
      const where = filters.length ? and(...filters) : undefined;
      const rows = await database.select(fields).from(deductions)
        .innerJoin(employees, eq(employees.id, deductions.employeeId))
        .innerJoin(branches, eq(branches.id, employees.branchId))
        .where(where).orderBy(asc(deductions.payrollMonth), asc(deductions.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      const totals = await database.select({ value: count() }).from(deductions)
        .innerJoin(employees, eq(employees.id, deductions.employeeId)).where(where);
      return { items: rows.map((row) => expose(row)!), total: totals[0]?.value ?? 0 };
    },
    async update(id, input) {
      const owner = (await database.select({ employeeId: deductions.employeeId }).from(deductions).where(eq(deductions.id, id)).limit(1))[0];
      if (!owner) return { kind: 'not_found' as const };
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, owner.employeeId);
        if (!employee) return { kind: 'not_found' as const };
        const current = await rawFind(transaction, id);
        if (!current) return { kind: 'not_found' as const };
        if (employee.deletedAt) return { kind: 'employee_deleted' as const };
        const currentMonth = current.payrollMonth.slice(0, 7);
        if (await isFinalized(transaction, employee.id, currentMonth)) return { kind: 'finalized' as const };
        const targetMonth = input.payrollMonth ?? currentMonth;
        if (targetMonth < calendarMonthInTimeZone(employee.createdAt, timeZone)) return { kind: 'ineligible_month' as const };
        if (targetMonth > context.currentMonth()) return { kind: 'future_month' as const };
        if (await isFinalized(transaction, employee.id, targetMonth)) return { kind: 'finalized' as const };
        const before = expose(current)!;
        await transaction.update(deductions).set({
          ...(input.amount === undefined ? {} : { amount: input.amount }),
          ...(input.payrollMonth === undefined ? {} : { payrollMonth: payrollMonthStart(input.payrollMonth) }),
          updatedAt: context.now(),
        }).where(eq(deductions.id, id));
        const record = (await findRecord(transaction, id))!;
        await writeFinancialAudit(transaction, { entityType: 'deduction', entityId: id, action: 'update', beforeState: before, afterState: record, createdAt: context.now() });
        return { kind: 'success' as const, record };
      });
    },
    async remove(id) {
      const owner = (await database.select({ employeeId: deductions.employeeId }).from(deductions).where(eq(deductions.id, id)).limit(1))[0];
      if (!owner) return { kind: 'not_found' as const };
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, owner.employeeId);
        const current = await rawFind(transaction, id);
        if (!employee || !current) return { kind: 'not_found' as const };
        if (employee.deletedAt) return { kind: 'employee_deleted' as const };
        if (await isFinalized(transaction, employee.id, current.payrollMonth.slice(0, 7))) return { kind: 'finalized' as const };
        const before = expose(current)!;
        await transaction.delete(deductions).where(eq(deductions.id, id));
        await writeFinancialAudit(transaction, { entityType: 'deduction', entityId: id, action: 'delete', beforeState: before, createdAt: context.now() });
        return { kind: 'success' as const };
      });
    },
  };
};
