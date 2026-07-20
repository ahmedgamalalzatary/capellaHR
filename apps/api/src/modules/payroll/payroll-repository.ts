import type { ListPayrollMonthsQuery } from '@capella/contracts';
import {
  advanceInstallments,
  bonuses,
  branches,
  deductions,
  employeeSalaryPeriods,
  employees,
  payrollMonths,
} from '@capella/database/schema';
import { and, asc, desc, eq, lt, lte, or, sql } from 'drizzle-orm';

import {
  calculatePayroll,
  calendarMonthInTimeZone,
  isPayrollSnapshotAmount,
  payrollMonthStart,
} from './payroll-domain.js';
import {
  createFinancialContext,
  type Database,
  type Executor,
  isFinalized,
  lockEmployee,
  type Transaction,
  writeFinancialAudit,
} from './financial-repository-helpers.js';
import type {
  BaseSalaryRecord,
  PayrollAttendanceGateway,
  PayrollRecord,
  PayrollRepository,
} from './payroll-service.js';

const salaryFields = {
  employeeId: employees.id, employeeCode: employees.employeeCode, employeeName: employees.fullName,
  branchId: employees.branchId, branchName: branches.name, amount: employees.monthlyBaseSalary,
  deletedAt: employees.deletedAt,
};
const findSalary = async (executor: Executor, employeeId: number): Promise<BaseSalaryRecord | null> => (
  await executor.select(salaryFields).from(employees)
    .innerJoin(branches, eq(branches.id, employees.branchId))
    .where(eq(employees.id, employeeId)).limit(1)
)[0] ?? null;

const payrollFields = {
  id: payrollMonths.id, employeeId: payrollMonths.employeeId,
  employeeCode: employees.employeeCode, employeeName: employees.fullName,
  branchId: employees.branchId, branchName: branches.name,
  payrollMonth: payrollMonths.payrollMonth, status: payrollMonths.status,
  baseSalary: payrollMonths.baseSalary, proratedBase: payrollMonths.proratedBase,
  overtimeAmount: payrollMonths.overtimeAmount, bonusAmount: payrollMonths.bonusAmount,
  attendanceDeductionAmount: payrollMonths.attendanceDeductionAmount,
  manualDeductionAmount: payrollMonths.manualDeductionAmount,
  advanceAmount: payrollMonths.advanceAmount, priorNegativeCarry: payrollMonths.priorNegativeCarry,
  netSalary: payrollMonths.netSalary, eligibleWorkdays: payrollMonths.eligibleWorkdays,
  fullMonthWorkdays: payrollMonths.fullMonthWorkdays, requiredMinutes: payrollMonths.requiredMinutes,
  overtimeMinutes: payrollMonths.overtimeMinutes, shortageMinutes: payrollMonths.shortageMinutes,
  finalizedAt: payrollMonths.finalizedAt,
};
const exposeFinalized = (row: Awaited<ReturnType<typeof rawFinalized>>): PayrollRecord | null => row
  ? { ...row, payrollMonth: row.payrollMonth.slice(0, 7), status: 'finalized' } : null;
const rawFinalized = async (executor: Executor, employeeId: number, month: string) => (
  await executor.select(payrollFields).from(payrollMonths)
    .innerJoin(employees, eq(employees.id, payrollMonths.employeeId))
    .innerJoin(branches, eq(branches.id, employees.branchId))
    .where(and(eq(payrollMonths.employeeId, employeeId), eq(payrollMonths.payrollMonth, payrollMonthStart(month))))
    .limit(1)
)[0] ?? null;

const sumAmount = async (
  executor: Executor,
  table: typeof bonuses | typeof deductions | typeof advanceInstallments,
  employeeId: number,
  month: string,
) => (await executor.select({ value: sql<string>`coalesce(sum(${table.amount}), 0.00)` })
  .from(table).where(and(
    eq(table.employeeId, employeeId), eq(table.payrollMonth, payrollMonthStart(month)),
  )))[0]?.value ?? '0.00';

const salaryForMonth = async (
  transaction: Transaction,
  employee: NonNullable<Awaited<ReturnType<typeof lockEmployee>>>,
  month: string,
) => (await transaction.select({ amount: employeeSalaryPeriods.baseSalary })
  .from(employeeSalaryPeriods).where(and(
    eq(employeeSalaryPeriods.employeeId, employee.id),
    lte(employeeSalaryPeriods.effectiveMonth, payrollMonthStart(month)),
  )).orderBy(desc(employeeSalaryPeriods.effectiveMonth)).limit(1))[0]?.amount
  ?? employee.monthlyBaseSalary;

const priorCarry = async (transaction: Transaction, employeeId: number, month: string) => {
  const previous = (await transaction.select({ netSalary: payrollMonths.netSalary })
    .from(payrollMonths).where(and(
      eq(payrollMonths.employeeId, employeeId), lt(payrollMonths.payrollMonth, payrollMonthStart(month)),
    )).orderBy(desc(payrollMonths.payrollMonth)).limit(1))[0]?.netSalary;
  return previous?.startsWith('-') ? previous : '0.00';
};

type Computed = { kind: 'success'; payroll: PayrollRecord } | { kind: 'blocked'; reasons: string[] };
const compute = async (
  transaction: Transaction,
  employee: NonNullable<Awaited<ReturnType<typeof lockEmployee>>>,
  month: string,
  attendance: PayrollAttendanceGateway,
): Promise<Computed> => {
  const existing = exposeFinalized(await rawFinalized(transaction, employee.id, month));
  if (existing) return { kind: 'success', payroll: existing };
  const attendanceResult = await attendance.readPayrollFacts(employee.id, month, transaction);
  if (attendanceResult.kind === 'blocked') return attendanceResult;
  const [baseSalary, bonusAmount, manualDeductionAmount, advanceAmount, carry] = await Promise.all([
    salaryForMonth(transaction, employee, month),
    sumAmount(transaction, bonuses, employee.id, month),
    sumAmount(transaction, deductions, employee.id, month),
    sumAmount(transaction, advanceInstallments, employee.id, month),
    priorCarry(transaction, employee.id, month),
  ]);
  const calculated = calculatePayroll({
    baseSalary,
    ...attendanceResult.facts,
    bonuses: bonusAmount,
    deductions: manualDeductionAmount,
    advances: advanceAmount,
    priorNegativeCarry: carry,
  });
  const snapshotAmounts = [
    baseSalary,
    calculated.proratedBase,
    calculated.overtimeAmount,
    bonusAmount,
    calculated.attendanceDeductionAmount,
    manualDeductionAmount,
    advanceAmount,
    carry,
    calculated.netSalary,
  ];
  if (!snapshotAmounts.every(isPayrollSnapshotAmount)) {
    return { kind: 'blocked', reasons: ['PAYROLL_AMOUNT_OUT_OF_RANGE'] };
  }
  const branchName = (await transaction.select({ name: branches.name }).from(branches)
    .where(eq(branches.id, employee.branchId)).limit(1))[0]?.name ?? '';
  return {
    kind: 'success',
    payroll: {
      id: 0, employeeId: employee.id, employeeCode: employee.employeeCode,
      employeeName: employee.fullName, branchId: employee.branchId, branchName,
      payrollMonth: month, status: 'open', baseSalary,
      ...calculated, bonusAmount, manualDeductionAmount, advanceAmount,
      priorNegativeCarry: carry, ...attendanceResult.facts, finalizedAt: null,
    },
  };
};

const insertFinalized = async (transaction: Transaction, payroll: PayrollRecord, at: Date) => {
  const inserted = await transaction.insert(payrollMonths).values({
    employeeId: payroll.employeeId, payrollMonth: payrollMonthStart(payroll.payrollMonth),
    status: 'finalized', baseSalary: payroll.baseSalary, proratedBase: payroll.proratedBase,
    overtimeAmount: payroll.overtimeAmount, bonusAmount: payroll.bonusAmount,
    attendanceDeductionAmount: payroll.attendanceDeductionAmount,
    manualDeductionAmount: payroll.manualDeductionAmount, advanceAmount: payroll.advanceAmount,
    priorNegativeCarry: payroll.priorNegativeCarry, netSalary: payroll.netSalary,
    eligibleWorkdays: payroll.eligibleWorkdays, fullMonthWorkdays: payroll.fullMonthWorkdays,
    requiredMinutes: payroll.requiredMinutes, overtimeMinutes: payroll.overtimeMinutes,
    shortageMinutes: payroll.shortageMinutes, finalizedAt: at, createdAt: at, updatedAt: at,
  });
  const id = Number(inserted[0].insertId);
  const stored = exposeFinalized(await rawFinalized(transaction, payroll.employeeId, payroll.payrollMonth))!;
  await writeFinancialAudit(transaction, { entityType: 'payroll', entityId: id, action: 'finalize', afterState: stored, createdAt: at });
  return stored;
};

const chronological = async (
  transaction: Transaction,
  employee: NonNullable<Awaited<ReturnType<typeof lockEmployee>>>,
  month: string,
  timeZone: string,
) => {
  let cursor = calendarMonthInTimeZone(employee.createdAt, timeZone);
  while (cursor < month) {
    if (!await isFinalized(transaction, employee.id, cursor)) return false;
    const [year, monthNumber] = cursor.split('-').map(Number) as [number, number];
    const next = monthNumber === 12 ? [year + 1, 1] : [year, monthNumber + 1];
    cursor = `${next[0]}-${String(next[1]).padStart(2, '0')}`;
  }
  return true;
};

const employeeEligibleForMonth = (
  employee: { createdAt: Date; deletedAt: Date | null },
  month: string,
  timeZone: string,
) => {
  if (month < calendarMonthInTimeZone(employee.createdAt, timeZone)) return false;
  return !employee.deletedAt || month <= calendarMonthInTimeZone(employee.deletedAt, timeZone);
};

export const createDrizzlePayrollRepository = (
  database: Database,
  options: { now?: () => Date; timeZone?: string } = {},
): PayrollRepository => {
  const timeZone = options.timeZone ?? 'Africa/Cairo';
  const context = createFinancialContext(options.now, timeZone);
  return {
    getBaseSalary(employeeId) { return findSalary(database, employeeId); },
    findFinalized(employeeId, month) {
      return rawFinalized(database, employeeId, month).then(exposeFinalized);
    },
    updateBaseSalary(employeeId, amount) {
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, employeeId);
        if (!employee) return { kind: 'employee_not_found' as const };
        if (employee.deletedAt) return { kind: 'employee_deleted' as const };
        const at = context.now();
        const creationMonth = calendarMonthInTimeZone(employee.createdAt, timeZone);
        const currentMonth = context.currentMonth();
        await transaction.insert(employeeSalaryPeriods).values({
          employeeId, effectiveMonth: payrollMonthStart(creationMonth), baseSalary: employee.monthlyBaseSalary,
          createdAt: at, updatedAt: at,
        }).onDuplicateKeyUpdate({ set: { updatedAt: at } });
        await transaction.insert(employeeSalaryPeriods).values({
          employeeId, effectiveMonth: payrollMonthStart(currentMonth), baseSalary: amount,
          createdAt: at, updatedAt: at,
        }).onDuplicateKeyUpdate({ set: { baseSalary: amount, updatedAt: at } });
        await transaction.update(employees).set({ monthlyBaseSalary: amount, updatedAt: at })
          .where(eq(employees.id, employeeId));
        const salary = (await findSalary(transaction, employeeId))!;
        await writeFinancialAudit(transaction, {
          entityType: 'salary', entityId: employeeId, action: 'update',
          beforeState: { amount: employee.monthlyBaseSalary }, afterState: salary, createdAt: at,
        });
        return { kind: 'success' as const, salary };
      });
    },
    async list(query: ListPayrollMonthsQuery, attendance) {
      if (query.month > context.currentMonth()) return { kind: 'month_not_ended' as const };
      const filters = [];
      if (query.branchId !== undefined) filters.push(eq(employees.branchId, query.branchId));
      if (query.search !== undefined) filters.push(or(
        sql`locate(${query.search}, ${employees.fullName}) > 0`,
        sql`locate(${query.search}, cast(${employees.employeeCode} as char)) > 0`,
      )!);
      const where = filters.length ? and(...filters) : undefined;
      const candidates = await database.select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        createdAt: employees.createdAt,
        deletedAt: employees.deletedAt,
      }).from(employees).where(where).orderBy(asc(employees.employeeCode));
      const eligible = candidates.filter((employee) => employeeEligibleForMonth(employee, query.month, timeZone));
      const rows = eligible.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
      const items: PayrollRecord[] = [];
      const reasons: string[] = [];
      for (const row of rows) {
        const result = await this.preview(row.id, query.month, attendance);
        if (result.kind === 'success') items.push(result.payroll);
        else if (result.kind === 'blocked') {
          reasons.push(...result.reasons.map((reason) => `${row.id}:${reason}`));
        } else {
          reasons.push(`${row.id}:PAYROLL_MONTH_NOT_ELIGIBLE`);
        }
      }
      if (reasons.length) return { kind: 'blocked' as const, reasons };
      return { kind: 'success' as const, items, total: eligible.length };
    },
    preview(employeeId, month, attendance) {
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, employeeId);
        if (!employee) return { kind: 'employee_not_found' as const };
        if (!employeeEligibleForMonth(employee, month, timeZone)) return { kind: 'month_not_eligible' as const };
        if (month > context.currentMonth()) return { kind: 'month_not_ended' as const };
        const result = await compute(transaction, employee, month, attendance);
        return result.kind === 'success' ? result : { kind: 'blocked' as const, reasons: result.reasons };
      });
    },
    finalize(employeeId, month, attendance) {
      return database.transaction(async (transaction) => {
        const employee = await lockEmployee(transaction, employeeId);
        if (!employee) return { kind: 'employee_not_found' as const };
        if (!employeeEligibleForMonth(employee, month, timeZone)) return { kind: 'month_not_eligible' as const };
        if (month >= context.currentMonth()) return { kind: 'month_not_ended' as const };
        if (await isFinalized(transaction, employeeId, month)) return { kind: 'already_finalized' as const };
        if (!await chronological(transaction, employee, month, timeZone)) return { kind: 'chronology_conflict' as const };
        const result = await compute(transaction, employee, month, attendance);
        if (result.kind === 'blocked') return result;
        return { kind: 'success' as const, payroll: await insertFinalized(transaction, result.payroll, context.now()) };
      });
    },
    finalizeBranch(branchId, month, attendance) {
      return database.transaction(async (transaction) => {
        const branch = (await transaction.select({ id: branches.id }).from(branches)
          .where(eq(branches.id, branchId)).for('update').limit(1))[0];
        if (!branch) return { kind: 'branch_not_found' as const };
        if (month >= context.currentMonth()) return { kind: 'month_not_ended' as const };
        const employeeRows = await transaction.select({ id: employees.id }).from(employees)
          .where(eq(employees.branchId, branchId)).orderBy(asc(employees.id)).for('update');
        const existingPayrolls: PayrollRecord[] = [];
        const calculated: PayrollRecord[] = [];
        const reasons: string[] = [];
        for (const row of employeeRows) {
          const employee = await lockEmployee(transaction, row.id);
          if (!employee) continue;
          if (!employeeEligibleForMonth(employee, month, timeZone)) continue;
          const existing = exposeFinalized(await rawFinalized(transaction, row.id, month));
          if (existing) {
            existingPayrolls.push(existing);
            continue;
          }
          if (!await chronological(transaction, employee, month, timeZone)) {
            reasons.push(`${row.id}:PAYROLL_CHRONOLOGY_CONFLICT`);
            continue;
          }
          const result = await compute(transaction, employee, month, attendance);
          if (result.kind === 'blocked') reasons.push(...result.reasons.map((reason) => `${row.id}:${reason}`));
          else calculated.push(result.payroll);
        }
        if (reasons.length) return { kind: 'blocked' as const, reasons };
        const payrolls: PayrollRecord[] = [...existingPayrolls];
        const at = context.now();
        for (const payroll of calculated) payrolls.push(await insertFinalized(transaction, payroll, at));
        return { kind: 'success' as const, payrolls };
      });
    },
    isFinalized(employeeId, attendanceDate, transactionContext) {
      return isFinalized((transactionContext as Transaction | undefined) ?? database, employeeId, attendanceDate.slice(0, 7));
    },
  };
};
