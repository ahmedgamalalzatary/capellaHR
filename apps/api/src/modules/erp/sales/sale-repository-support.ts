import { type createDatabase } from '@capella/database';
import {
  commissionLedgerEntries, employees, invoiceLines, invoiceLineReassignments,
  invoiceReversalLines, invoiceReversalPayments, invoiceReversals, invoices,
} from '@capella/database/schema';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import type { ErpPayrollCapability } from '../hr-capabilities.js';
import { nextMonth, startOfCairoDate } from '../cairo-calendar.js';
import { SaleError, type ReassignInvoiceLineOperation, type ReverseInvoiceOperation, type SaleRepository } from './sale-service.js';
import { hydrateInvoice, reconstructInput } from './sale-repository-read.js';
import { toCents } from './services/sale-calculations.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

const signedMoney = (value: bigint) => {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
};

export const createSaleRepositorySupport = (database: Database, payroll?: ErpPayrollCapability) => {
  const projectCommission = async (
    transaction: Transaction,
    employeeId: number,
    month: string,
  ) => {
    if (!payroll) return undefined;
    return payroll.projectCommission({
      employeeId,
      payrollMonth: month,
      calculateAmount: async () => {
        const entries = await transaction.select({ amount: commissionLedgerEntries.amount })
          .from(commissionLedgerEntries)
          .innerJoin(invoices, eq(invoices.id, commissionLedgerEntries.invoiceId))
          .where(and(
            eq(commissionLedgerEntries.employeeId, employeeId),
            gte(invoices.soldAt, startOfCairoDate(`${month}-01`)),
            lt(invoices.soldAt, startOfCairoDate(`${nextMonth(month)}-01`)),
          ));
        return signedMoney(entries.reduce((total, entry) => total + toCents(entry.amount), 0n));
      },
      reference: `erp-commission:${month}:${employeeId}`,
    }, transaction);
  };
  /**
   * The distinct employees behind each invoice's services, in line order, for
   * list screens that no longer read a single employee off the invoice.
   */
  const listInvoiceEmployees = async (invoiceIds: number[]) => {
    const byInvoice = new Map<number, Array<{ id: number; name: string }>>();
    if (!invoiceIds.length) return byInvoice;
    const rows = await database.select({
      id: invoiceLines.id,
      invoiceId: invoiceLines.invoiceId,
      employeeId: invoiceLines.employeeId,
      employeeName: invoiceLines.employeeNameSnapshot,
    }).from(invoiceLines).where(and(
      inArray(invoiceLines.invoiceId, invoiceIds),
      isNotNull(invoiceLines.employeeId),
    )).orderBy(asc(invoiceLines.invoiceId), asc(invoiceLines.lineNumber));
    const reassignedRows = await database.select().from(invoiceLineReassignments).where(
      inArray(invoiceLineReassignments.invoiceId, invoiceIds),
    ).orderBy(
      asc(invoiceLineReassignments.invoiceLineId),
      desc(invoiceLineReassignments.createdAt),
      desc(invoiceLineReassignments.id),
    );
    const latestByLine = new Map<number, number>();
    for (const row of reassignedRows) {
      if (!latestByLine.has(row.invoiceLineId)) latestByLine.set(row.invoiceLineId, row.toEmployeeId);
    }
    const targetIds = [...new Set(latestByLine.values())];
    const targets = targetIds.length ? await database.select({
      id: employees.id, name: employees.fullName,
    }).from(employees).where(inArray(employees.id, targetIds)) : [];
    const targetById = new Map(targets.map((employee) => [employee.id, employee.name]));
    for (const row of rows) {
      const current = byInvoice.get(row.invoiceId) ?? [];
      const employeeId = latestByLine.get(row.id) ?? row.employeeId!;
      const employeeName = targetById.get(employeeId) ?? row.employeeName!;
      if (current.some((employee) => employee.id === employeeId)) continue;
      current.push({ id: employeeId, name: employeeName });
      byInvoice.set(row.invoiceId, current);
    }
    return byInvoice;
  };

  const findByIdempotencyKey: SaleRepository['findByIdempotencyKey'] = async (key, actor) => {
    const predicate = actor.actingAccountRole === 'cashier'
      ? and(
          eq(invoices.idempotencyKey, key),
          eq(invoices.actingAccountId, actor.actingAccountId),
        )
      : eq(invoices.idempotencyKey, key);
    const row = (await database.select({
      id: invoices.id,
      kind: invoices.kind,
      sellerEmployeeId: invoices.sellerEmployeeId,
    }).from(invoices)
      .where(predicate).limit(1))[0];
    if (!row) return null;
    // A sale without a seller is either a branch transfer, which replays like
    // any other, or a row that predates sellers and can no longer be replayed.
    if (row.sellerEmployeeId === null && row.kind === 'sale') {
      throw new SaleError('IDEMPOTENCY_CONFLICT');
    }
    const invoice = await hydrateInvoice(database, row.id);
    if (!invoice) return null;
    return { input: await reconstructInput(database, row.id), invoice };
  };

  const existingReversal = async (
    operation: ReverseInvoiceOperation,
    executor: Executor = database,
  ) => {
    const predicate = operation.actingAccountRole === 'cashier'
      ? and(
          eq(invoiceReversals.idempotencyKey, operation.input.idempotencyKey),
          eq(invoiceReversals.actingAccountId, operation.actingAccountId),
          eq(invoiceReversals.status, 'finalized'),
        )
      : and(
          eq(invoiceReversals.idempotencyKey, operation.input.idempotencyKey),
          eq(invoiceReversals.status, 'finalized'),
        );
    const row = (await executor.select().from(invoiceReversals).where(predicate).limit(1))[0];
    if (!row) return null;
    const lines = await executor.select().from(invoiceReversalLines)
      .where(eq(invoiceReversalLines.reversalId, row.id)).orderBy(asc(invoiceReversalLines.id));
    const payments = await executor.select().from(invoiceReversalPayments)
      .where(eq(invoiceReversalPayments.reversalId, row.id)).orderBy(asc(invoiceReversalPayments.id));
    const reconstructed = row.type === 'void'
      ? {
          type: row.type, invoiceId: row.invoiceId,
          input: {
            branchId: row.branchId, idempotencyKey: row.idempotencyKey, reason: row.reason,
          },
        }
      : {
          type: row.type, invoiceId: row.invoiceId,
          input: {
            branchId: row.branchId, idempotencyKey: row.idempotencyKey, reason: row.reason,
            lines: lines.map((line) => ({
              invoiceLineId: line.invoiceLineId, quantity: line.quantity,
            })),
            payments: payments.filter((payment) => payment.cashAmount !== '0.00')
              .map((payment) => ({
                method: payment.methodSnapshot, amount: payment.cashAmount,
              })),
          },
        };
    if (!isDeepStrictEqual(reconstructed, {
      type: operation.type, invoiceId: operation.invoiceId, input: operation.input,
    })) throw new SaleError('IDEMPOTENCY_CONFLICT');
    const invoice = await hydrateInvoice(executor, row.invoiceId);
    if (!invoice) throw new SaleError('INVOICE_NOT_FOUND');
    return invoice;
  };

  const existingReassignment = async (
    operation: ReassignInvoiceLineOperation,
    executor: Executor = database,
  ) => {
    const row = (await executor.select().from(invoiceLineReassignments).where(
      eq(invoiceLineReassignments.operationReference, operation.input.operationReference),
    ).limit(1))[0];
    if (!row) return null;
    if (row.invoiceId !== operation.invoiceId
      || row.invoiceLineId !== operation.invoiceLineId
      || row.toEmployeeId !== operation.input.employeeId) {
      throw new SaleError('IDEMPOTENCY_CONFLICT');
    }
    const invoice = await hydrateInvoice(executor, row.invoiceId);
    if (!invoice) throw new SaleError('INVOICE_NOT_FOUND');
    return invoice;
  };
  return {
    projectCommission, listInvoiceEmployees, findByIdempotencyKey,
    existingReversal, existingReassignment,
  };
};
