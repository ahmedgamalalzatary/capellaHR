import type { createDatabase } from '@capella/database';
import {
  commissionLedgerEntries,
  employees,
  invoiceLines,
  invoices,
} from '@capella/database/schema';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';

import type { CommissionEntry, CommissionListQuery, CommissionSummary } from '@capella/contracts';
import { nextMonth, startOfCairoDate } from '../cairo-calendar.js';
import type { CommissionRepository } from './commission-service.js';

type Database = ReturnType<typeof createDatabase>;

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
const entryFields = {
  id: commissionLedgerEntries.id,
  type: commissionLedgerEntries.entryType,
  invoiceId: invoices.id,
  invoiceNumber: invoices.invoiceNumber,
  invoiceLineId: invoiceLines.id,
  lineNumber: invoiceLines.lineNumber,
  serviceName: invoiceLines.itemNameSnapshot,
  baseAmount: commissionLedgerEntries.baseAmount,
  commissionRate: commissionLedgerEntries.commissionRateSnapshot,
  amount: commissionLedgerEntries.amount,
  reversalId: commissionLedgerEntries.invoiceReversalId,
  occurredAt: commissionLedgerEntries.createdAt,
};

export const createDrizzleCommissionRepository = (database: Database): CommissionRepository => {
  const readEntries = async (employeeId: number, month: string, branchId?: number) => {
    const start = startOfCairoDate(`${month}-01`);
    const end = startOfCairoDate(`${nextMonth(month)}-01`);
    return database.select(entryFields).from(commissionLedgerEntries)
      .innerJoin(invoices, eq(invoices.id, commissionLedgerEntries.invoiceId))
      .innerJoin(invoiceLines, eq(invoiceLines.id, commissionLedgerEntries.invoiceLineId))
      .where(and(
        eq(commissionLedgerEntries.employeeId, employeeId),
        eq(invoices.assignedEmployeeId, employeeId),
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
  const summarize = async (
    employeeId: number,
    month: string,
    branchId?: number,
  ): Promise<{ summary: CommissionSummary; entries: CommissionEntry[] } | null> => {
    const identity = await employee(employeeId);
    if (!identity) return null;
    const rows = await readEntries(employeeId, month, branchId);
    if (branchId !== undefined && rows.length === 0) return null;
    let earned = 0n;
    let reversed = 0n;
    for (const row of rows) {
      if (row.type === 'earned') earned += toCents(row.amount);
      else reversed += -toCents(row.amount);
    }
    return {
      summary: {
        ...identity,
        payrollMonth: month,
        earnedAmount: money(earned),
        reversedAmount: money(reversed),
        netAmount: money(earned - reversed),
        invoiceLineCount: rows.filter(({ type }) => type === 'earned').length,
        reversalCount: rows.filter(({ type }) => type === 'reversal').length,
      },
      entries: rows.map((row) => ({
        ...row,
        occurredAt: row.occurredAt.toISOString(),
      })),
    };
  };

  return {
    async list(branchId: number, query: CommissionListQuery) {
      const start = startOfCairoDate(`${query.month}-01`);
      const end = startOfCairoDate(`${nextMonth(query.month)}-01`);
      const ids = (await database.selectDistinct({ employeeId: invoices.assignedEmployeeId })
        .from(invoices).innerJoin(
          commissionLedgerEntries,
          and(
            eq(commissionLedgerEntries.invoiceId, invoices.id),
            eq(commissionLedgerEntries.employeeId, invoices.assignedEmployeeId),
          ),
        ).where(and(
          eq(invoices.branchId, branchId),
          gte(invoices.soldAt, start),
          lt(invoices.soldAt, end),
          ...(query.employeeId === undefined
            ? []
            : [eq(invoices.assignedEmployeeId, query.employeeId)]),
        ))).map(({ employeeId }) => employeeId);
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
      return summarize(employeeId, month, branchId);
    },
    async summary(employeeId, month) {
      return (await summarize(employeeId, month))?.summary ?? null;
    },
  };
};
