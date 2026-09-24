import type { createDatabase } from '@capella/database';
import {
  commissionLedgerEntries,
  cashierSessions,
  employees,
  erpCommissionPayouts,
  erpExpenses,
  erpPostPayrollDeductions,
  invoiceLines,
  invoices,
  payrollMonths,
} from '@capella/database/schema';
import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';

import type {
  CommissionDetail,
  CommissionListQuery,
  CommissionPayout,
  CommissionSummary,
} from '@capella/contracts';
import { cairoMonth, nextMonth, startOfCairoDate } from '../cairo-calendar.js';
import type { ErpAuditCapability } from '../hr-capabilities.js';
import { CASHIER_SESSION_MAX_DURATION_MS } from '../sales/index.js';
import { availableCommission, canPayCommission, carriedCommissionDebt } from './commission-domain.js';
import type { CommissionRepository, CreatePayoutInput } from './commission-service.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const payrollMonthStart = (month: string) => `${month}-01`;
const isFinalized = async (
  executor: Database | Transaction,
  employeeId: number,
  month: string,
) => Boolean((await executor.select({ id: payrollMonths.id }).from(payrollMonths).where(and(
  eq(payrollMonths.employeeId, employeeId),
  eq(payrollMonths.payrollMonth, payrollMonthStart(month)),
)).limit(1))[0]);
const lockEmployee = async (transaction: Transaction, employeeId: number) => (
  await transaction.select({
    id: employees.id,
    fullName: employees.fullName,
    employmentStatus: employees.employmentStatus,
    deletedAt: employees.deletedAt,
  }).from(employees).where(eq(employees.id, employeeId)).for('update').limit(1)
)[0] ?? null;

const toCents = (value: string) => {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = '00'] = (negative ? value.slice(1) : value).split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction);
  return negative ? -cents : cents;
};
const money = (value: bigint) => {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};
const nonNegative = (value: string) => (toCents(value) < 0n ? '0.00' : value);

const entryFields = {
  id: commissionLedgerEntries.id,
  type: commissionLedgerEntries.entryType,
  invoiceId: invoices.id,
  invoiceNumber: invoices.invoiceNumber,
  invoiceLineId: invoiceLines.id,
  lineNumber: invoiceLines.lineNumber,
  itemType: invoiceLines.itemType,
  unitPrice: invoiceLines.unitPrice,
  serviceName: invoiceLines.itemNameSnapshot,
  baseAmount: commissionLedgerEntries.baseAmount,
  commissionRate: commissionLedgerEntries.commissionRateSnapshot,
  amount: commissionLedgerEntries.amount,
  reversalId: commissionLedgerEntries.invoiceReversalId,
  reassignmentId: commissionLedgerEntries.invoiceLineReassignmentId,
  occurredAt: commissionLedgerEntries.createdAt,
};

const calendarDateInTimeZone = (instant: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};

const payoutFields = {
  id: erpCommissionPayouts.id,
  employeeId: erpCommissionPayouts.employeeId,
  commissionMonth: erpCommissionPayouts.commissionMonth,
  branchId: erpCommissionPayouts.branchId,
  amount: erpCommissionPayouts.amount,
  expenseId: erpCommissionPayouts.expenseId,
  reason: erpCommissionPayouts.reason,
  createdAt: erpCommissionPayouts.createdAt,
};

const mapPayout = (row: {
  id: number; employeeId: number; commissionMonth: string; branchId: number;
  amount: string; expenseId: number; reason: string | null; createdAt: Date;
}): CommissionPayout => ({
  id: row.id,
  employeeId: row.employeeId,
  payrollMonth: row.commissionMonth.slice(0, 7),
  branchId: row.branchId,
  amount: row.amount,
  expenseId: row.expenseId,
  reason: row.reason,
  createdAt: row.createdAt.toISOString(),
});

export const createDrizzleCommissionRepository = (
  database: Database,
  options: { audit: ErpAuditCapability; now?: () => Date },
): CommissionRepository => {
  const now = options.now ?? (() => new Date());
  const readEntries = async (
    employeeId: number,
    month: string,
    branchId?: number,
    executor: Database | Transaction = database,
  ) => {
    const start = startOfCairoDate(`${month}-01`);
    const end = startOfCairoDate(`${nextMonth(month)}-01`);
    return executor.select(entryFields).from(commissionLedgerEntries)
      .innerJoin(invoices, eq(invoices.id, commissionLedgerEntries.invoiceId))
      .innerJoin(invoiceLines, eq(invoiceLines.id, commissionLedgerEntries.invoiceLineId))
      .where(and(
        eq(commissionLedgerEntries.employeeId, employeeId),
        gte(invoices.soldAt, start),
        lt(invoices.soldAt, end),
        ...(branchId === undefined ? [] : [eq(invoices.branchId, branchId)]),
      )).orderBy(asc(commissionLedgerEntries.id));
  };
  const employee = async (employeeId: number) => (
    await database.select({
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      employeeName: employees.fullName,
    }).from(employees).where(eq(employees.id, employeeId)).limit(1)
  )[0] ?? null;
  const paidForMonth = async (executor: Database | Transaction, employeeId: number, month: string) => {
    const rows = await executor.select({ amount: erpCommissionPayouts.amount })
      .from(erpCommissionPayouts)
      .where(and(
        eq(erpCommissionPayouts.employeeId, employeeId),
        eq(erpCommissionPayouts.commissionMonth, payrollMonthStart(month)),
      ));
    return rows.reduce((sum, row) => sum + toCents(row.amount), 0n);
  };
  const debtForMonth = async (executor: Database | Transaction, employeeId: number, month: string) => {
    const previous = (await executor.select({
      month: payrollMonths.payrollMonth, amount: payrollMonths.commissionCarryAmount,
    })
      .from(payrollMonths).where(and(
        eq(payrollMonths.employeeId, employeeId),
        lt(payrollMonths.payrollMonth, payrollMonthStart(month)),
      )).orderBy(desc(payrollMonths.payrollMonth)).limit(1))[0];
    const firstOpenMonth = previous ? nextMonth(previous.month.slice(0, 7)) : undefined;
    const payouts = await executor.select({ month: erpCommissionPayouts.commissionMonth, amount: erpCommissionPayouts.amount })
      .from(erpCommissionPayouts).where(and(
        eq(erpCommissionPayouts.employeeId, employeeId),
        lt(erpCommissionPayouts.commissionMonth, payrollMonthStart(month)),
        ...(firstOpenMonth ? [gte(erpCommissionPayouts.commissionMonth, payrollMonthStart(firstOpenMonth))] : []),
      ));
    const reversals = await executor.select({ amount: erpPostPayrollDeductions.amount })
      .from(erpPostPayrollDeductions).where(and(
        eq(erpPostPayrollDeductions.employeeId, employeeId),
        eq(erpPostPayrollDeductions.payrollMonth, payrollMonthStart(month)),
      ));
    const earlierReversals = await executor.select({ month: erpPostPayrollDeductions.payrollMonth, amount: erpPostPayrollDeductions.amount })
      .from(erpPostPayrollDeductions).where(and(
        eq(erpPostPayrollDeductions.employeeId, employeeId),
        lt(erpPostPayrollDeductions.payrollMonth, payrollMonthStart(month)),
        ...(firstOpenMonth ? [gte(erpPostPayrollDeductions.payrollMonth, payrollMonthStart(firstOpenMonth))] : []),
      ));
    const months = new Map<string, { net: bigint; paid: bigint; reversals: bigint }>();
    const rowFor = (key: string) => {
      const existing = months.get(key);
      if (existing) return existing;
      const created = { net: 0n, paid: 0n, reversals: 0n };
      months.set(key, created);
      return created;
    };
    for (const row of payouts) rowFor(row.month.slice(0, 7)).paid += toCents(row.amount);
    for (const row of earlierReversals) rowFor(row.month.slice(0, 7)).reversals += toCents(row.amount);
    const firstMonth = firstOpenMonth ?? [...months.keys()].sort()[0];
    if (firstMonth) {
      const ledger = await executor.select({ amount: commissionLedgerEntries.amount, soldAt: invoices.soldAt })
        .from(commissionLedgerEntries)
        .innerJoin(invoices, eq(invoices.id, commissionLedgerEntries.invoiceId))
        .where(and(
          eq(commissionLedgerEntries.employeeId, employeeId),
          gte(invoices.soldAt, startOfCairoDate(`${firstMonth}-01`)),
          lt(invoices.soldAt, startOfCairoDate(`${month}-01`)),
        ));
      for (const row of ledger) rowFor(cairoMonth(row.soldAt)).net += toCents(row.amount);
    }
    const carried = carriedCommissionDebt(previous?.amount ?? '0.00',
      [...months.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, row]) => ({
        net: money(row.net), paid: money(row.paid), reversals: money(row.reversals),
      })));
    return money(toCents(carried) + reversals.reduce((sum, row) => sum + toCents(row.amount), 0n));
  };
  /**
   * Availability is employee-wide for the commission month: a sale can move branches,
   * and the drawer that pays must see every available pound of that month's commission.
   */
  const globalNetForMonth = async (
    employeeId: number,
    month: string,
    executor: Database | Transaction = database,
  ) => {
    const rows = await readEntries(employeeId, month, undefined, executor);
    let earned = 0n;
    let reversed = 0n;
    for (const row of rows) {
      if (row.type === 'earned' || row.type === 'reassignment_in') earned += toCents(row.amount);
      else reversed += -toCents(row.amount);
    }
    return earned - reversed;
  };
  const listPayouts = async (employeeId: number, month: string, executor: Database | Transaction = database) => {
    const rows = await executor.select(payoutFields).from(erpCommissionPayouts)
      .where(and(
        eq(erpCommissionPayouts.employeeId, employeeId),
        eq(erpCommissionPayouts.commissionMonth, payrollMonthStart(month)),
      )).orderBy(asc(erpCommissionPayouts.id));
    return rows.map(mapPayout);
  };
  const summarize = async (
    employeeId: number,
    month: string,
    branchId?: number,
    executor: Database | Transaction = database,
  ): Promise<{ summary: CommissionSummary; entries: CommissionDetail['entries']; payouts: CommissionPayout[] } | null> => {
    const identity = await employee(employeeId);
    if (!identity) return null;
    const rows = await readEntries(employeeId, month, branchId, executor);
    if (branchId !== undefined && rows.length === 0) return null;
    let earned = 0n;
    let reversed = 0n;
    let serviceUnitCount = 0;
    for (const row of rows) {
      if (row.type === 'earned' || row.type === 'reassignment_in') earned += toCents(row.amount);
      else reversed += -toCents(row.amount);
      if (row.itemType === 'service') {
        const units = Number(toCents(row.baseAmount) / toCents(row.unitPrice));
        serviceUnitCount += row.type === 'earned' || row.type === 'reassignment_in'
          ? units : -units;
      }
    }
    const paid = await paidForMonth(executor, employeeId, month);
    const debt = await debtForMonth(executor, employeeId, month);
    const globalNet = branchId === undefined
      ? earned - reversed
      : await globalNetForMonth(employeeId, month, executor);
    const available = toCents(availableCommission(money(globalNet), money(paid), debt));
    const payouts = await listPayouts(employeeId, month, executor);
    return {
      summary: {
        ...identity,
        payrollMonth: month,
        earnedAmount: money(earned),
        reversedAmount: money(reversed),
        netAmount: money(earned - reversed),
        paidAmount: money(paid),
        availableAmount: nonNegative(money(available)),
        invoiceLineCount: rows.filter(({ type }) => type === 'earned' || type === 'reassignment_in').length,
        serviceUnitCount,
        reversalCount: rows.filter(({ type }) => type === 'reversal' || type === 'reassignment_out').length,
      },
      entries: rows.map((row) => {
        const detail = { ...row };
        Reflect.deleteProperty(detail, 'itemType');
        Reflect.deleteProperty(detail, 'unitPrice');
        return { ...detail, occurredAt: row.occurredAt.toISOString() };
      }),
      payouts,
    };
  };

  return {
    async list(branchId: number, query: CommissionListQuery) {
      const start = startOfCairoDate(`${query.month}-01`);
      const end = startOfCairoDate(`${nextMonth(query.month)}-01`);
      // Commission follows the service line, so one invoice can list several
      // employees here.
      const ids = [...new Set((await database.selectDistinct({ employeeId: commissionLedgerEntries.employeeId })
        .from(invoices).innerJoin(
          invoiceLines,
          eq(invoiceLines.invoiceId, invoices.id),
        ).innerJoin(
          commissionLedgerEntries,
          and(
            eq(commissionLedgerEntries.invoiceId, invoices.id),
            eq(commissionLedgerEntries.invoiceLineId, invoiceLines.id),
          ),
        ).where(and(
          eq(invoices.branchId, branchId),
          gte(invoices.soldAt, start),
          lt(invoices.soldAt, end),
          ...(query.employeeId === undefined
            ? []
            : [eq(commissionLedgerEntries.employeeId, query.employeeId)]),
        ))).map(({ employeeId }) => employeeId).filter((id): id is number => id !== null))];
      if (ids.length === 0) return { items: [], total: 0 };
      const ordered = await database.select({ id: employees.id }).from(employees)
        .where(inArray(employees.id, ids)).orderBy(asc(employees.employeeCode));
      const pageIds = ordered.slice(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize,
      );
      const items: CommissionSummary[] = [];
      for (const { id } of pageIds) {
        const result = await summarize(id, query.month, branchId);
        if (result) items.push(result.summary);
      }
      return { items, total: ordered.length };
    },
    async detail(branchId, employeeId, month) {
      const result = await summarize(employeeId, month, branchId);
      if (!result) return null;
      return { summary: result.summary, entries: result.entries, payouts: result.payouts };
    },
    async summary(employeeId, month) {
      return (await summarize(employeeId, month))?.summary ?? null;
    },
    async createPayout(input: CreatePayoutInput) {
      return database.transaction(async (transaction) => {
        // A quick eligibility read preserves useful errors; the locked checks below are authoritative.
        const candidate = await employee(input.employeeId);
        if (!candidate) return { kind: 'employee_not_found' as const };
        if (await isFinalized(transaction, input.employeeId, input.month)) {
          return { kind: 'finalized' as const };
        }
        const at = now();
        const shift = (await transaction.select({ openedAt: cashierSessions.openedAt })
          .from(cashierSessions)
          .where(and(eq(cashierSessions.branchId, input.branchId), isNull(cashierSessions.closedAt)))
          .for('update').limit(1))[0];
        if (!shift || shift.openedAt > at
          || at.getTime() >= shift.openedAt.getTime() + CASHIER_SESSION_MAX_DURATION_MS) {
          return { kind: 'shift_not_open' as const };
        }
        const lockedEmployee = await lockEmployee(transaction, input.employeeId);
        if (!lockedEmployee) return { kind: 'employee_not_found' as const };
        if (lockedEmployee.deletedAt || lockedEmployee.employmentStatus === 'inactive') {
          return { kind: 'employee_deleted' as const };
        }
        if (await isFinalized(transaction, input.employeeId, input.month)) {
          return { kind: 'finalized' as const };
        }
        const globalNet = await globalNetForMonth(input.employeeId, input.month, transaction);
        const paid = await paidForMonth(transaction, input.employeeId, input.month);
        const debt = await debtForMonth(transaction, input.employeeId, input.month);
        const available = availableCommission(money(globalNet), money(paid), debt);
        if (!canPayCommission(available, input.amount)) {
          return { kind: 'insufficient_available' as const };
        }
        const actingAccountId = input.accountId;
        const expense = await transaction.insert(erpExpenses).values({
          branchId: input.branchId,
          name: 'صرف عمولة',
          amount: input.amount,
          expenseDate: calendarDateInTimeZone(at, 'Africa/Cairo'),
          description: `commission payout for employee ${lockedEmployee.fullName}`,
          actingAccountId,
          createdAt: at,
        });
        const expenseId = Number(expense[0].insertId);
        const inserted = await transaction.insert(erpCommissionPayouts).values({
          employeeId: input.employeeId,
          commissionMonth: payrollMonthStart(input.month),
          branchId: input.branchId,
          amount: input.amount,
          expenseId,
          actingAccountId,
          reason: input.reason ?? null,
          createdAt: at,
        });
        const payout: CommissionPayout = {
          id: Number(inserted[0].insertId),
          employeeId: input.employeeId,
          payrollMonth: input.month,
          branchId: input.branchId,
          amount: input.amount,
          expenseId,
          reason: input.reason ?? null,
          createdAt: at.toISOString(),
        };
        await options.audit.record(transaction, {
          module: 'erp-commissions', action: 'payout', entityType: 'commission_payout',
          entityId: payout.id, afterState: payout,
          relatedIds: { employeeId: input.employeeId, branchId: input.branchId,
            actingAccountId, expenseId }, createdAt: at,
        });
        const refreshed = await summarize(input.employeeId, input.month, input.branchId, transaction);
        if (!refreshed) return { kind: 'employee_not_found' as const };
        return { kind: 'success' as const, payout, summary: refreshed.summary };
      });
    },
  };
};
