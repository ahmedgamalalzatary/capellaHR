import type { ListAdvancesQuery } from '@capella/contracts';
import {
  advanceInstallments,
  advances,
  branches,
  employeeBranchAssignments,
  employees,
  payrollMonths,
} from '@capella/database/schema';
import { and, asc, count, eq, or, sql } from 'drizzle-orm';

import {
  createFinancialContext,
  type Database,
  type Executor,
  isFinalized,
  lockEmployee,
  type Transaction,
  writeFinancialAudit,
} from '../payroll/financial-repository-helpers.js';
import {
  addPayrollMonths,
  calendarMonthInTimeZone,
  isValidInstallmentSchedule,
  payrollMonthStart,
  splitInstallments,
} from '../payroll/payroll-domain.js';
import type { AdvanceRecord, AdvanceRepository } from './advances-service.js';
import { branchIdAt } from '../../shared/database/branch-id-at.js';

const { branchId: branchIdAtCreation, assignment: assignmentAtCreation } = branchIdAt(
  employeeBranchAssignments, advances.employeeId, advances.createdAt,
);
const fields = {
  id: advances.id, employeeId: advances.employeeId, employeeCode: employees.employeeCode,
  employeeName: employees.fullName, branchId: branchIdAtCreation, branchName: branches.name,
  amount: advances.amount, installmentCount: advances.installmentCount, startMonth: advances.startMonth,
  employeeDeletedAt: employees.deletedAt, createdAt: advances.createdAt, updatedAt: advances.updatedAt,
};
const rawFind = async (executor: Executor, id: number) => (
  await executor.select(fields).from(advances)
    .innerJoin(employees, eq(employees.id, advances.employeeId))
    .leftJoin(employeeBranchAssignments, assignmentAtCreation)
    .innerJoin(branches, eq(branches.id, branchIdAtCreation))
    .where(eq(advances.id, id)).limit(1)
)[0] ?? null;
const findRecord = async (executor: Executor, id: number): Promise<AdvanceRecord | null> => {
  const record = await rawFind(executor, id);
  if (!record) return null;
  const installments = await executor.select({
    id: advanceInstallments.id,
    ordinal: advanceInstallments.ordinal,
    payrollMonth: advanceInstallments.payrollMonth,
    amount: advanceInstallments.amount,
  }).from(advanceInstallments).where(eq(advanceInstallments.advanceId, id))
    .orderBy(asc(advanceInstallments.ordinal));
  return {
    ...record,
    startMonth: record.startMonth.slice(0, 7),
    installments: installments.map((installment) => ({
      ...installment, payrollMonth: installment.payrollMonth.slice(0, 7),
    })),
  };
};
const hasFinalizedInstallment = async (transaction: Transaction, advanceId: number) => Boolean((
  await transaction.select({ id: payrollMonths.id }).from(advanceInstallments)
    .innerJoin(payrollMonths, and(
      eq(payrollMonths.employeeId, advanceInstallments.employeeId),
      eq(payrollMonths.payrollMonth, advanceInstallments.payrollMonth),
    ))
    .where(eq(advanceInstallments.advanceId, advanceId)).limit(1)
)[0]);
const insertSchedule = async (
  transaction: Transaction,
  advanceId: number,
  employeeId: number,
  schedule: ReturnType<typeof splitInstallments>,
  at: Date,
) => transaction.insert(advanceInstallments).values(schedule.map((item) => ({
  advanceId, employeeId, ordinal: item.ordinal, payrollMonth: payrollMonthStart(item.payrollMonth),
  amount: item.amount, createdAt: at,
})));
const hasFinalizedScheduleMonth = async (
  transaction: Transaction,
  employeeId: number,
  schedule: ReturnType<typeof splitInstallments>,
) => {
  let finalized = false;
  for (const installment of schedule) {
    if (await isFinalized(transaction, employeeId, installment.payrollMonth)) finalized = true;
  }
  return finalized;
};
const firstUnfinalizedMonth = async (
  transaction: Transaction,
  employeeId: number,
  initialMonth: string,
) => {
  let month = initialMonth;
  while (await isFinalized(transaction, employeeId, month)) {
    if (month === '9999-12') throw new RangeError('No safe payroll month is available for advance acceleration');
    month = addPayrollMonths(month, 1);
  }
  return month;
};

export const createDrizzleAdvanceRepository = (
  database: Database,
  options: { now?: () => Date; timeZone?: string } = {},
): AdvanceRepository => {
  const context = createFinancialContext(options.now, options.timeZone);
  const timeZone = options.timeZone ?? 'Africa/Cairo';
  return {
    create(input) {
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, input.employeeId);
        if (!employee) return { kind: 'employee_not_found' as const };
        if (employee.deletedAt) return { kind: 'employee_deleted' as const };
        if (!isValidInstallmentSchedule(input.amount, input.installmentCount, input.startMonth)) {
          return { kind: 'invalid_schedule' as const };
        }
        if (input.startMonth < calendarMonthInTimeZone(employee.createdAt, timeZone)) return { kind: 'ineligible_month' as const };
        const schedule = splitInstallments(input.amount, input.installmentCount, input.startMonth);
        if (await hasFinalizedScheduleMonth(transaction, input.employeeId, schedule)) return { kind: 'finalized' as const };
        const at = context.now();
        const inserted = await transaction.insert(advances).values({
          employeeId: input.employeeId, amount: input.amount, installmentCount: input.installmentCount,
          startMonth: payrollMonthStart(input.startMonth), createdAt: at, updatedAt: at,
        });
        const id = Number(inserted[0].insertId);
        await insertSchedule(transaction, id, input.employeeId, schedule, at);
        const record = (await findRecord(transaction, id))!;
        await writeFinancialAudit(transaction, { entityType: 'advance', entityId: id, action: 'create', afterState: record, createdAt: at });
        return { kind: 'success' as const, record };
      });
    },
    findById(id) { return findRecord(database, id); },
    async list(query: ListAdvancesQuery) {
      const filters = [];
      if (query.employeeId !== undefined) filters.push(eq(advances.employeeId, query.employeeId));
      if (query.branchId !== undefined) filters.push(eq(branchIdAtCreation, query.branchId));
      if (query.payrollMonth !== undefined) filters.push(sql`exists (
        select 1 from ${advanceInstallments}
        where ${advanceInstallments.advanceId} = ${advances.id}
          and ${advanceInstallments.payrollMonth} = ${payrollMonthStart(query.payrollMonth)}
      )`);
      if (query.search !== undefined) filters.push(or(
        sql`locate(${query.search}, ${employees.fullName}) > 0`,
        sql`locate(${query.search}, cast(${employees.employeeCode} as char)) > 0`,
      )!);
      const where = filters.length ? and(...filters) : undefined;
      const rows = await database.select({ id: advances.id }).from(advances)
        .innerJoin(employees, eq(employees.id, advances.employeeId))
        .leftJoin(employeeBranchAssignments, assignmentAtCreation).where(where)
        .orderBy(asc(advances.startMonth), asc(advances.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      const totals = await database.select({ value: count() }).from(advances)
        .innerJoin(employees, eq(employees.id, advances.employeeId))
        .leftJoin(employeeBranchAssignments, assignmentAtCreation).where(where);
      const items = await Promise.all(rows.map(({ id }) => findRecord(database, id)));
      return { items: items.filter((item): item is AdvanceRecord => item !== null), total: totals[0]?.value ?? 0 };
    },
    async update(id, input) {
      const owner = (await database.select({ employeeId: advances.employeeId }).from(advances).where(eq(advances.id, id)).limit(1))[0];
      if (!owner) return { kind: 'not_found' as const };
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, owner.employeeId);
        if (!employee) return { kind: 'not_found' as const };
        const current = await findRecord(transaction, id);
        if (!current) return { kind: 'not_found' as const };
        if (employee.deletedAt) return { kind: 'employee_deleted' as const };
        if (await hasFinalizedInstallment(transaction, id)) return { kind: 'finalized' as const };
        const amount = input.amount ?? current.amount;
        const installmentCount = input.installmentCount ?? current.installmentCount;
        const startMonth = input.startMonth ?? current.startMonth;
        if (!isValidInstallmentSchedule(amount, installmentCount, startMonth)) {
          return { kind: 'invalid_schedule' as const };
        }
        if (startMonth < calendarMonthInTimeZone(employee.createdAt, timeZone)) return { kind: 'ineligible_month' as const };
        const schedule = splitInstallments(amount, installmentCount, startMonth);
        if (await hasFinalizedScheduleMonth(transaction, employee.id, schedule)) return { kind: 'finalized' as const };
        const at = context.now();
        await transaction.delete(advanceInstallments).where(eq(advanceInstallments.advanceId, id));
        await transaction.update(advances).set({
          amount, installmentCount, startMonth: payrollMonthStart(startMonth), updatedAt: at,
        }).where(eq(advances.id, id));
        await insertSchedule(transaction, id, employee.id, schedule, at);
        const record = (await findRecord(transaction, id))!;
        await writeFinancialAudit(transaction, { entityType: 'advance', entityId: id, action: 'update', beforeState: current, afterState: record, createdAt: at });
        return { kind: 'success' as const, record };
      });
    },
    async remove(id) {
      const owner = (await database.select({ employeeId: advances.employeeId }).from(advances).where(eq(advances.id, id)).limit(1))[0];
      if (!owner) return { kind: 'not_found' as const };
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, owner.employeeId);
        const current = await findRecord(transaction, id);
        if (!employee || !current) return { kind: 'not_found' as const };
        if (employee.deletedAt) return { kind: 'employee_deleted' as const };
        if (await hasFinalizedInstallment(transaction, id)) return { kind: 'finalized' as const };
        await transaction.delete(advanceInstallments).where(eq(advanceInstallments.advanceId, id));
        await transaction.delete(advances).where(eq(advances.id, id));
        await writeFinancialAudit(transaction, { entityType: 'advance', entityId: id, action: 'delete', beforeState: current, createdAt: context.now() });
        return { kind: 'success' as const };
      });
    },
    async accelerateForDeletion(employeeId, deletedAt, transactionContext) {
      const transaction = transactionContext as Transaction;
      const deletionMonth = calendarMonthInTimeZone(deletedAt, timeZone);
      const destinationMonth = await firstUnfinalizedMonth(transaction, employeeId, deletionMonth);
      const rows = await transaction.select({ id: advances.id }).from(advances)
        .where(eq(advances.employeeId, employeeId));
      for (const { id } of rows) {
        const before = await findRecord(transaction, id);
        if (!before) continue;
        const remaining = await transaction.select({
          id: advanceInstallments.id,
          amount: advanceInstallments.amount,
          ordinal: advanceInstallments.ordinal,
        }).from(advanceInstallments)
          .leftJoin(payrollMonths, and(
            eq(payrollMonths.employeeId, advanceInstallments.employeeId),
            eq(payrollMonths.payrollMonth, advanceInstallments.payrollMonth),
          ))
          .where(and(eq(advanceInstallments.advanceId, id), sql`${payrollMonths.id} is null`));
        if (!remaining.length) continue;
        const remainingCents = remaining.reduce((sum, item) => {
          const [whole, fraction = ''] = item.amount.split('.');
          return sum + BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
        }, 0n);
        const amount = `${remainingCents / 100n}.${String(remainingCents % 100n).padStart(2, '0')}`;
        await transaction.delete(advanceInstallments).where(and(
          eq(advanceInstallments.advanceId, id),
          sql`${advanceInstallments.id} in (${sql.join(remaining.map((item) => sql`${item.id}`), sql`, `)})`,
        ));
        await transaction.insert(advanceInstallments).values({
          advanceId: id, employeeId, ordinal: Math.min(...remaining.map((item) => item.ordinal)),
          payrollMonth: payrollMonthStart(destinationMonth), amount, createdAt: deletedAt,
        });
        const after = await findRecord(transaction, id);
        await writeFinancialAudit(transaction, {
          entityType: 'advance', entityId: id, action: 'accelerate',
          beforeState: before, afterState: after, createdAt: deletedAt,
        });
      }
    },
  };
};
