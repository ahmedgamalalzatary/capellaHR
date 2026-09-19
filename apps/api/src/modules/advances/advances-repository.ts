import type { ListAdvancesQuery } from '@capella/contracts';
import {
  accounts,
  advanceInstallments,
  advances,
  branches,
  employeeBranchAssignments,
  employeeDeactivationAdjustments,
  employeeOutstandingDebts,
  employees,
  erpExpenses,
  payrollMonths,
} from '@capella/database/schema';
import { and, asc, count, eq, isNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

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
  reason: advances.reason,
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
// Sign lives on the value as a whole, not on its parts: `-400.50` is -40050 cents, and the
// fractional digits are always printed unsigned behind a single leading minus.
const amountFromCents = (value: bigint) => {
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`;
};
const amountToCents = (value: string) => {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const magnitude = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -magnitude : magnitude;
};
const calendarDateInTimeZone = (instant: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const requireActiveAdminId = async (transaction: Transaction) => {
  const actor = (await transaction.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.role, 'admin'), eq(accounts.active, true), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.id)).limit(1))[0];
  if (!actor) throw new Error('Advance cash-out requires an admin account');
  return actor.id;
};
const insertAdvanceExpense = async (
  transaction: Transaction,
  input: {
    advanceId: number;
    branchId: number;
    amount: string;
    expenseDate: string;
    description: string;
    actingAccountId: number;
    createdAt: Date;
  },
) => {
  const inserted = await transaction.insert(erpExpenses).values({
    branchId: input.branchId,
    name: 'advance',
    amount: input.amount,
    expenseDate: input.expenseDate,
    description: input.description,
    actingAccountId: input.actingAccountId,
    createdAt: input.createdAt,
  });
  await transaction.update(advances).set({ expenseId: Number(inserted[0].insertId) })
    .where(eq(advances.id, input.advanceId));
};
const linkedExpenseId = async (transaction: Transaction, advanceId: number) => (
  await transaction.select({ expenseId: advances.expenseId }).from(advances)
    .where(eq(advances.id, advanceId)).limit(1)
)[0]?.expenseId ?? null;
const replaceAdvanceExpense = async (
  transaction: Transaction,
  expenseId: number,
  input: {
    branchId: number;
    amount: string;
    expenseDate: string;
    description: string;
    actingAccountId: number;
    createdAt: Date;
    reason: string;
  },
) => {
  const correctionOperationId = randomUUID();
  await transaction.execute(sql`CALL correct_erp_expense(
    ${expenseId}, ${input.branchId}, ${'advance'}, ${input.amount}, ${input.expenseDate},
    ${input.description}, ${input.actingAccountId}, ${input.reason}, ${input.createdAt},
    ${correctionOperationId}
  )`);
  const replacement = (await transaction.select({ id: erpExpenses.id }).from(erpExpenses)
    .where(and(
      eq(erpExpenses.correctionOperationId, correctionOperationId),
      eq(erpExpenses.supersedesId, expenseId),
    )).limit(1))[0];
  if (!replacement) throw new Error('Advance expense replacement was not created');
  return replacement.id;
};
const reverseAdvanceExpense = async (
  transaction: Transaction,
  expenseId: number,
  actingAccountId: number,
  createdAt: Date,
  reason: string,
) => {
  const original = (await transaction.select().from(erpExpenses)
    .where(eq(erpExpenses.id, expenseId)).limit(1))[0];
  if (!original || original.kind !== 'expense') {
    throw new Error('Advance cash-out expense is missing');
  }
  const correctionOperationId = randomUUID();
  await transaction.execute(sql`INSERT INTO erp_expense_correction_guards
    (connection_id, operation_id, original_id)
    VALUES (CONNECTION_ID(), ${correctionOperationId}, ${expenseId})`);
  await transaction.insert(erpExpenses).values({
    branchId: original.branchId,
    name: original.name,
    amount: original.amount,
    expenseDate: original.expenseDate,
    description: original.description,
    actingAccountId,
    kind: 'reversal',
    reversalOfId: original.id,
    correctionOperationId,
    correctionReason: reason,
    createdAt,
  });
  await transaction.execute(sql`DELETE FROM erp_expense_correction_guards
    WHERE connection_id = CONNECTION_ID()`);
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
        if (employee.deletedAt || employee.employmentStatus === 'inactive') return { kind: 'employee_deleted' as const };
        if (!isValidInstallmentSchedule(input.amount, input.installmentCount, input.startMonth)) {
          return { kind: 'invalid_schedule' as const };
        }
        if (input.startMonth < calendarMonthInTimeZone(employee.createdAt, timeZone)) return { kind: 'ineligible_month' as const };
        const schedule = splitInstallments(input.amount, input.installmentCount, input.startMonth);
        if (await hasFinalizedScheduleMonth(transaction, input.employeeId, schedule)) return { kind: 'finalized' as const };
        const at = context.now();
        const inserted = await transaction.insert(advances).values({
          employeeId: input.employeeId, amount: input.amount, installmentCount: input.installmentCount,
          startMonth: payrollMonthStart(input.startMonth), reason: input.reason, createdAt: at, updatedAt: at,
        });
        const id = Number(inserted[0].insertId);
        await insertSchedule(transaction, id, input.employeeId, schedule, at);
        const record = (await findRecord(transaction, id))!;
        const actingAccountId = await requireActiveAdminId(transaction);
        await insertAdvanceExpense(transaction, {
          advanceId: id,
          branchId: record.branchId,
          amount: input.amount,
          expenseDate: calendarDateInTimeZone(at, timeZone),
          description: `advance for employee ${record.employeeName}`,
          actingAccountId,
          createdAt: at,
        });
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
        if (employee.deletedAt || employee.employmentStatus === 'inactive') return { kind: 'employee_deleted' as const };
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
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        }).where(eq(advances.id, id));
        await insertSchedule(transaction, id, employee.id, schedule, at);
        const record = (await findRecord(transaction, id))!;
        const expenseId = await linkedExpenseId(transaction, id);
        if (expenseId === null) throw new Error('Advance cash-out expense is missing');
        if (amount !== current.amount) {
          const actingAccountId = await requireActiveAdminId(transaction);
          const replacementId = await replaceAdvanceExpense(transaction, expenseId, {
            branchId: record.branchId,
            amount,
            expenseDate: calendarDateInTimeZone(current.createdAt, timeZone),
            description: `advance for employee ${record.employeeName}`,
            actingAccountId,
            createdAt: at,
            reason: 'advance updated',
          });
          await transaction.update(advances).set({ expenseId: replacementId }).where(eq(advances.id, id));
        }
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
        if (employee.deletedAt || employee.employmentStatus === 'inactive') return { kind: 'employee_deleted' as const };
        if (await hasFinalizedInstallment(transaction, id)) return { kind: 'finalized' as const };
        const expenseId = await linkedExpenseId(transaction, id);
        if (expenseId === null) throw new Error('Advance cash-out expense is missing');
        const actingAccountId = await requireActiveAdminId(transaction);
        await reverseAdvanceExpense(transaction, expenseId, actingAccountId, context.now(), 'advance deleted');
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
    async deactivationImpact(employeeId, at, transactionContext) {
      const executor = (transactionContext as Executor | undefined) ?? database;
      const currentMonth = payrollMonthStart(calendarMonthInTimeZone(at, timeZone));
      const rows = await executor.select({
        amount: advanceInstallments.amount,
        payrollMonth: advanceInstallments.payrollMonth,
      }).from(advanceInstallments)
        .leftJoin(payrollMonths, and(
          eq(payrollMonths.employeeId, advanceInstallments.employeeId),
          eq(payrollMonths.payrollMonth, advanceInstallments.payrollMonth),
        ))
        .where(and(eq(advanceInstallments.employeeId, employeeId), sql`${payrollMonths.id} is null`));
      const total = rows.reduce((sum, row) => sum + amountToCents(row.amount), 0n);
      const current = rows.filter((row) => row.payrollMonth === currentMonth)
        .reduce((sum, row) => sum + amountToCents(row.amount), 0n);
      return {
        unpaidInstallmentCount: rows.length,
        unpaidAdvanceAmount: amountFromCents(total),
        currentMonthAdvanceAmount: amountFromCents(current),
      };
    },
    async recordDeactivationAdjustment(employeeId, at, reason, amount, transactionContext) {
      const transaction = transactionContext as Transaction;
      const month = payrollMonthStart(calendarMonthInTimeZone(at, timeZone));
      // Signed, but never zero: a no-op adjustment would only add noise to the ledger.
      if (amountToCents(amount) === 0n) throw new Error('Deactivation adjustment must be non-zero');
      await transaction.insert(employeeDeactivationAdjustments).values({
        employeeId,
        payrollMonth: month,
        reason,
        amount,
        createdAt: at,
      }).onDuplicateKeyUpdate({
        set: {
          amount: sql`${employeeDeactivationAdjustments.amount} + values(${employeeDeactivationAdjustments.amount})`,
        },
      });
    },
    async recordOutstandingDebt(employeeId, at, amount, transactionContext) {
      const transaction = transactionContext as Transaction;
      const month = payrollMonthStart(calendarMonthInTimeZone(at, timeZone));
      if (amountToCents(amount) <= 0n) throw new Error('Outstanding debt must be positive');
      await transaction.insert(employeeOutstandingDebts).values({
        employeeId,
        payrollMonth: month,
        amount,
        createdAt: at,
      }).onDuplicateKeyUpdate({
        set: {
          amount: sql`${employeeOutstandingDebts.amount} + values(${employeeOutstandingDebts.amount})`,
        },
      });
    },
  };
};
