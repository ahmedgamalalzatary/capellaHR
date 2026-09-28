import type { ListBonusesQuery } from '@capella/contracts';
import { bonuses, branches, employeeBranchAssignments, employees } from '@capella/database/schema';
import { and, asc, count, eq, or, sql } from 'drizzle-orm';

import {
  createFinancialContext,
  type Database,
  type Executor,
  isFinalized,
  lockEmployee,
  resolveAdjustmentAmount,
  writeFinancialAudit,
} from '../payroll/financial-repository-helpers.js';
import { calendarMonthInTimeZone, payrollMonthStart } from '../payroll/payroll-domain.js';
import type { BonusRecord, BonusRepository } from './bonuses-service.js';
import { branchIdAt } from '../../shared/database/branch-id-at.js';

const { branchId: branchIdAtCreation, assignment: assignmentAtCreation } = branchIdAt(
  employeeBranchAssignments, bonuses.employeeId, bonuses.createdAt,
);
const fields = {
  id: bonuses.id, employeeId: bonuses.employeeId, employeeCode: employees.employeeCode,
  employeeName: employees.fullName, branchId: branchIdAtCreation, branchName: branches.name,
  payrollMonth: bonuses.payrollMonth, amount: bonuses.amount, reason: bonuses.reason,
  days: bonuses.days, baseSalarySnapshot: bonuses.baseSalarySnapshot,
  employeeDeletedAt: employees.deletedAt,
  createdAt: bonuses.createdAt, updatedAt: bonuses.updatedAt,
};
const expose = (record: typeof fields extends never ? never : Awaited<ReturnType<typeof rawFind>>) => record
  ? { ...record, payrollMonth: record.payrollMonth.slice(0, 7) } : null;
const rawFind = async (executor: Executor, id: number) => (
  await executor.select(fields).from(bonuses)
    .innerJoin(employees, eq(employees.id, bonuses.employeeId))
    .leftJoin(employeeBranchAssignments, assignmentAtCreation)
    .innerJoin(branches, eq(branches.id, branchIdAtCreation))
    .where(eq(bonuses.id, id)).limit(1)
)[0] ?? null;
const findRecord = async (executor: Executor, id: number): Promise<BonusRecord | null> => expose(await rawFind(executor, id));

export const createDrizzleBonusRepository = (
  database: Database,
  options: { now?: () => Date; timeZone?: string } = {},
): BonusRepository => {
  const context = createFinancialContext(options.now, options.timeZone);
  const timeZone = options.timeZone ?? 'Africa/Cairo';
  return {
    create(input) {
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, input.employeeId);
        if (!employee) return { kind: 'employee_not_found' as const };
        if (employee.deletedAt || employee.employmentStatus === 'inactive') return { kind: 'employee_deleted' as const };
        if (input.payrollMonth < calendarMonthInTimeZone(employee.createdAt, timeZone)) return { kind: 'ineligible_month' as const };
        if (input.payrollMonth > context.currentMonth()) return { kind: 'future_month' as const };
        if (await isFinalized(transaction, input.employeeId, input.payrollMonth)) return { kind: 'finalized' as const };
        const priced = await resolveAdjustmentAmount(transaction, employee, input);
        const at = context.now();
        const inserted = await transaction.insert(bonuses).values({
          employeeId: input.employeeId, payrollMonth: payrollMonthStart(input.payrollMonth),
          amount: priced.amount, reason: input.reason,
          days: priced.days, baseSalarySnapshot: priced.baseSalarySnapshot,
          createdAt: at, updatedAt: at,
        });
        const id = Number(inserted[0].insertId);
        const record = (await findRecord(transaction, id))!;
        await writeFinancialAudit(transaction, { entityType: 'bonus', entityId: id, action: 'create', afterState: record, createdAt: at });
        return { kind: 'success' as const, record };
      });
    },
    findById(id) { return findRecord(database, id); },
    async list(query: ListBonusesQuery) {
      const filters = [];
      if (query.employeeId !== undefined) filters.push(eq(bonuses.employeeId, query.employeeId));
      if (query.branchId !== undefined) filters.push(eq(branchIdAtCreation, query.branchId));
      if (query.payrollMonth !== undefined) filters.push(eq(bonuses.payrollMonth, payrollMonthStart(query.payrollMonth)));
      if (query.search !== undefined) filters.push(or(
        sql`locate(${query.search}, ${employees.fullName}) > 0`,
        sql`locate(${query.search}, cast(${employees.employeeCode} as char)) > 0`,
      )!);
      const where = filters.length ? and(...filters) : undefined;
      const rows = await database.select(fields).from(bonuses)
        .innerJoin(employees, eq(employees.id, bonuses.employeeId))
        .leftJoin(employeeBranchAssignments, assignmentAtCreation)
        .innerJoin(branches, eq(branches.id, branchIdAtCreation))
        .where(where).orderBy(asc(bonuses.payrollMonth), asc(bonuses.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      const totals = await database.select({ value: count() }).from(bonuses)
        .innerJoin(employees, eq(employees.id, bonuses.employeeId))
        .leftJoin(employeeBranchAssignments, assignmentAtCreation).where(where);
      return { items: rows.map((row) => expose(row)!), total: totals[0]?.value ?? 0 };
    },
    async update(id, input) {
      const owner = (await database.select({ employeeId: bonuses.employeeId }).from(bonuses).where(eq(bonuses.id, id)).limit(1))[0];
      if (!owner) return { kind: 'not_found' as const };
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, owner.employeeId);
        if (!employee) return { kind: 'not_found' as const };
        const current = await rawFind(transaction, id);
        if (!current) return { kind: 'not_found' as const };
        if (employee.deletedAt || employee.employmentStatus === 'inactive') return { kind: 'employee_deleted' as const };
        const currentMonth = current.payrollMonth.slice(0, 7);
        if (await isFinalized(transaction, employee.id, currentMonth)) return { kind: 'finalized' as const };
        const targetMonth = input.payrollMonth ?? currentMonth;
        if (targetMonth < calendarMonthInTimeZone(employee.createdAt, timeZone)) return { kind: 'ineligible_month' as const };
        if (targetMonth > context.currentMonth()) return { kind: 'future_month' as const };
        if (await isFinalized(transaction, employee.id, targetMonth)) return { kind: 'finalized' as const };
        const before = expose(current)!;
        // A day-priced bonus belongs to the month it was priced in. Moving it to another
        // month changes that month's workday count, so the amount is derived again from
        // the stored day count rather than carried over — otherwise the same day count
        // would be worth different money in two months of the same statement.
        const repriced = await resolveAdjustmentAmount(transaction, employee, {
          payrollMonth: targetMonth,
          ...(input.days !== undefined
            ? { days: input.days }
            : input.amount !== undefined
              ? { amount: input.amount }
              // Neither given: keep whatever the row was priced under, in the new month.
              : current.days !== null
                ? { days: current.days }
                : { amount: current.amount }),
        });
        await transaction.update(bonuses).set({
          amount: repriced.amount,
          days: repriced.days,
          baseSalarySnapshot: repriced.baseSalarySnapshot,
          ...(input.payrollMonth === undefined ? {} : { payrollMonth: payrollMonthStart(input.payrollMonth) }),
          reason: input.reason,
          updatedAt: context.now(),
        }).where(eq(bonuses.id, id));
        const record = (await findRecord(transaction, id))!;
        await writeFinancialAudit(transaction, { entityType: 'bonus', entityId: id, action: 'update', beforeState: before, afterState: record, createdAt: context.now() });
        return { kind: 'success' as const, record };
      });
    },
    async remove(id) {
      const owner = (await database.select({ employeeId: bonuses.employeeId }).from(bonuses).where(eq(bonuses.id, id)).limit(1))[0];
      if (!owner) return { kind: 'not_found' as const };
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, owner.employeeId);
        const current = await rawFind(transaction, id);
        if (!employee || !current) return { kind: 'not_found' as const };
        if (employee.deletedAt || employee.employmentStatus === 'inactive') return { kind: 'employee_deleted' as const };
        if (await isFinalized(transaction, employee.id, current.payrollMonth.slice(0, 7))) return { kind: 'finalized' as const };
        const before = expose(current)!;
        await transaction.delete(bonuses).where(eq(bonuses.id, id));
        await writeFinancialAudit(transaction, { entityType: 'bonus', entityId: id, action: 'delete', beforeState: before, createdAt: context.now() });
        return { kind: 'success' as const };
      });
    },
  };
};
