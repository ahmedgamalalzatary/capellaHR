import { completeSaleSchema } from '@capella/contracts';
import { type createDatabase } from '@capella/database';
import {
  accounts,
  branchCashierRoster,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  erpCategories,
  erpBookings,
  erpProducts,
  erpProductStocks,
  erpStockMovements,
  erpServiceCommissionOverrides,
  erpServices,
  employees,
  invoiceLines,
  invoiceLineReassignments,
  invoicePayments,
  invoiceReversalLines,
  invoiceReversalPayments,
  invoiceReversals,
  invoices,
} from '@capella/database/schema';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  ne,
  or,
} from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { ErpAuditCapability, ErpPayrollCapability } from '../hr-capabilities.js';
import { cairoMonth, nextMonth, startOfCairoDate } from '../cairo-calendar.js';
import { CASHIER_SESSION_MAX_DURATION_MS } from './cashier-sessions-service.js';
import { SaleError, type CompleteSaleOperation, type ReassignInvoiceLineOperation, type RecordInvoicePaymentOperation, type ReverseInvoiceOperation, type SaleRepository } from './sale-service.js';
import {
  allocateReversalAmounts,
  calculateAdjustment,
  calculateCommission,
  calculateLineTotal,
  calculateSaleTotals,
  MoneyCalculationError,
  sumMoney,
  toCents,
} from './services/sale-calculations.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

const isDuplicateEntryError = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false;
  if (Reflect.get(error, 'code') === 'ER_DUP_ENTRY') return true;
  const cause: unknown = Reflect.get(error, 'cause');
  return typeof cause === 'object' && cause !== null
    && Reflect.get(cause, 'code') === 'ER_DUP_ENTRY';
};

const asIso = (value: Date) => value.toISOString();
const signedMoney = (value: bigint) => {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
};
const commissionCents = (base: bigint, rate: string) => (
  (base * toCents(rate) + 5_000n) / 10_000n
);
const invoiceBusinessDate = (invoiceNumber: string) => invoiceNumber.slice(4, 14).replaceAll('.', '-');
const cairoDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const keyedQueues = <T extends { itemType: string; sourceId: number }>(lines: T[]) => {
  const queues = new Map<string, T[]>();
  for (const line of lines) {
    const key = `${line.itemType}:${line.sourceId}`;
    const values = queues.get(key) ?? [];
    values.push(line);
    queues.set(key, values);
  }
  return queues;
};

const hydrateInvoice = async (executor: Executor, invoiceId: number) => {
  const invoice = (await executor.select().from(invoices)
    .where(eq(invoices.id, invoiceId)).limit(1))[0];
  if (!invoice || invoice.status === 'draft') return null;
  // The seller's code lives on the employee row; historical invoices may predate sellers.
  const sellerEmployee = invoice.sellerEmployeeId === null ? null
    : (await executor.select({ employeeCode: employees.employeeCode }).from(employees)
      .where(eq(employees.id, invoice.sellerEmployeeId)).limit(1))[0] ?? null;
  const lines = await executor.select().from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.lineNumber));
  const reassignments = await executor.select().from(invoiceLineReassignments)
    .where(eq(invoiceLineReassignments.invoiceId, invoiceId))
    .orderBy(asc(invoiceLineReassignments.createdAt), asc(invoiceLineReassignments.id));
  const reassignmentEmployeeIds = [...new Set(reassignments.flatMap((row) => [
    row.fromEmployeeId, row.toEmployeeId,
  ]))];
  const reassignmentEmployees = reassignmentEmployeeIds.length
    ? await executor.select({
      id: employees.id, employeeCode: employees.employeeCode, name: employees.fullName,
    }).from(employees).where(inArray(employees.id, reassignmentEmployeeIds))
    : [];
  const reassignmentEmployeeById = new Map(reassignmentEmployees.map((row) => [row.id, row]));
  const payments = await executor.select().from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoiceId)).orderBy(asc(invoicePayments.id));
  const reversals = await executor.select().from(invoiceReversals)
    .where(and(
      eq(invoiceReversals.invoiceId, invoiceId),
      eq(invoiceReversals.status, 'finalized'),
    )).orderBy(asc(invoiceReversals.id));
  const reversalIds = reversals.map(({ id }) => id);
  const reversalLines = reversalIds.length
    ? await executor.select().from(invoiceReversalLines)
      .where(inArray(invoiceReversalLines.reversalId, reversalIds)).orderBy(asc(invoiceReversalLines.id))
    : [];
  const reversalPayments = reversalIds.length
    ? await executor.select().from(invoiceReversalPayments)
      .where(inArray(invoiceReversalPayments.reversalId, reversalIds)).orderBy(asc(invoiceReversalPayments.id))
    : [];
  const accountIds = [...new Set([
    ...reversals.flatMap((reversal) => [
    reversal.actingAccountId,
    ...(reversal.approvingAccountId === null ? [] : [reversal.approvingAccountId]),
    ]),
    ...reassignments.map((row) => row.actingAccountId),
  ])];
  const reversalAccounts = accountIds.length
    ? await executor.select({ id: accounts.id, username: accounts.username }).from(accounts)
      .where(inArray(accounts.id, accountIds))
    : [];
  const accountById = new Map(reversalAccounts.map((account) => [account.id, account]));
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const refundedByLine = new Map<number, number>();
  for (const line of reversalLines) {
    refundedByLine.set(line.invoiceLineId, (refundedByLine.get(line.invoiceLineId) ?? 0) + line.quantity);
  }
  // A refund handed back on another method reverses no particular payment, so it
  // counts towards the invoice total without touching any payment's refundable rest.
  const refundedByPayment = new Map<number, bigint>();
  for (const payment of reversalPayments) {
    if (payment.invoicePaymentId === null) continue;
    refundedByPayment.set(
      payment.invoicePaymentId,
      (refundedByPayment.get(payment.invoicePaymentId) ?? 0n) + toCents(payment.cashAmount),
    );
  }

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    kind: invoice.kind,
    branchId: invoice.branchId,
    cashierSessionId: invoice.cashierSessionId,
    client: {
      id: invoice.clientId,
      name: invoice.clientNameSnapshot,
      phone: invoice.clientPhoneSnapshot,
    },
    seller: invoice.sellerEmployeeId === null || sellerEmployee === null ? null : {
      id: invoice.sellerEmployeeId,
      employeeCode: sellerEmployee.employeeCode,
      name: invoice.sellerNameSnapshot!,
    },
    authorizedBy: {
      accountId: invoice.actingAccountId,
      username: invoice.authorizedBySnapshot,
    },
    lines: lines.map((line) => {
      const history = reassignments.filter((row) => row.invoiceLineId === line.id);
      const latest = history.at(-1);
      const currentEmployee = latest
        ? reassignmentEmployeeById.get(latest.toEmployeeId)!
        : null;
      return ({
      id: line.id,
      lineNumber: line.lineNumber,
      itemType: line.itemType,
      sourceId: line.serviceId ?? line.productId!,
      name: line.itemNameSnapshot,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      employee: line.employeeId === null ? null : currentEmployee ?? {
        id: line.employeeId, employeeCode: line.employeeCodeSnapshot!, name: line.employeeNameSnapshot!,
      },
      originalEmployee: line.employeeId === null ? null : {
        id: line.employeeId, employeeCode: line.employeeCodeSnapshot!, name: line.employeeNameSnapshot!,
      },
      reassignments: history.map((row) => ({
        id: row.id,
        fromEmployee: reassignmentEmployeeById.get(row.fromEmployeeId)!,
        toEmployee: reassignmentEmployeeById.get(row.toEmployeeId)!,
        reason: row.reason,
        actingAccount: accountById.get(row.actingAccountId)!,
        createdAt: asIso(row.createdAt),
      })),
      commissionRule: line.commissionRuleSnapshot,
      commissionRate: line.commissionRateSnapshot,
      commissionAmount: line.commissionAmountSnapshot,
      productCostBasis: line.productCostBasisSnapshot,
      refundedQuantity: refundedByLine.get(line.id) ?? 0,
      refundableQuantity: line.quantity - (refundedByLine.get(line.id) ?? 0),
    }); }),
    discount: invoice.discountKind === null ? null : {
      kind: invoice.discountKind,
      value: invoice.discountValue!,
      amount: invoice.discountAmount,
    },
    tax: invoice.taxKind === null ? null : {
      kind: invoice.taxKind,
      value: invoice.taxValue!,
      amount: invoice.taxAmount,
    },
    totals: {
      subtotal: invoice.subtotal,
      discountAmount: invoice.discountAmount,
      taxAmount: invoice.taxAmount,
      total: invoice.total,
      paymentTotal: sumMoney(payments.map(({ amount }) => amount)),
      amountPaid: invoice.amountPaid,
      creditedAmount: invoice.creditedAmount,
      balanceDue: invoice.balanceDue!,
      settlementStatus: invoice.settlementStatus,
    },
    payments: payments.map(({ id, method, amount }) => {
      const refunded = refundedByPayment.get(id) ?? 0n;
      return {
        method,
        amount,
        refundedAmount: signedMoney(refunded),
        refundableAmount: signedMoney(toCents(amount) - refunded),
      };
    }),
    reversals: reversals.map((reversal) => ({
      id: reversal.id,
      type: reversal.type,
      reason: reversal.reason,
      actingAccount: {
        id: reversal.actingAccountId,
        username: accountById.get(reversal.actingAccountId)!.username,
      },
      approvingAccount: reversal.approvingAccountId === null ? null : {
        id: reversal.approvingAccountId,
        username: accountById.get(reversal.approvingAccountId)!.username,
      },
      lines: reversalLines.filter((line) => line.reversalId === reversal.id).map((line) => {
        const originalLine = lineById.get(line.invoiceLineId)!;
        return {
          invoiceLineId: line.invoiceLineId,
          lineNumber: originalLine.lineNumber,
          itemType: originalLine.itemType,
          name: originalLine.itemNameSnapshot,
          quantity: line.quantity,
          grossAmount: line.grossAmount,
          discountAmount: line.discountAmount,
          taxAmount: line.taxAmount,
          total: line.total,
        };
      }),
      payments: reversalPayments.filter((payment) => payment.reversalId === reversal.id)
        .filter((payment) => payment.cashAmount !== '0.00')
        .map((payment) => ({ method: payment.methodSnapshot, amount: payment.cashAmount })),
      totals: {
        grossAmount: reversal.grossAmount,
        discountAmount: reversal.discountAmount,
        taxAmount: reversal.taxAmount,
        total: reversal.total,
      },
      createdAt: asIso(reversal.createdAt),
    })),
    eligibility: {
      canVoid: invoice.status === 'completed'
        && (invoice.settlementStatus === 'settled' || invoice.amountPaid === '0.00')
        && invoiceBusinessDate(invoice.invoiceNumber) === cairoDate(new Date()),
      canRefund: invoice.status === 'completed' || invoice.status === 'partially_refunded',
    },
    soldAt: asIso(invoice.soldAt),
  };
};

const reconstructInput = async (executor: Executor, invoiceId: number) => {
  const invoice = (await executor.select().from(invoices)
    .where(eq(invoices.id, invoiceId)).limit(1))[0]!;
  const lines = await executor.select().from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.lineNumber));
  const payments = await executor.select().from(invoicePayments)
    .where(and(
      eq(invoicePayments.invoiceId, invoiceId), eq(invoicePayments.isInitial, true),
    )).orderBy(asc(invoicePayments.id));
  const booking = (await executor.select({ id: erpBookings.id }).from(erpBookings)
    .where(eq(erpBookings.invoiceId, invoiceId)).limit(1))[0];
  const candidate = {
    branchId: invoice.branchId,
    clientId: invoice.clientId,
    ...(invoice.sellerEmployeeId === null ? {} : {
      sellerEmployeeId: invoice.sellerEmployeeId,
    }),
    cashierSessionId: invoice.cashierSessionId,
    ...(booking ? { bookingId: booking.id } : {}),
    idempotencyKey: invoice.idempotencyKey,
    lines: lines.map((line) => line.itemType === 'service'
      ? {
          itemType: 'service' as const,
          serviceId: line.serviceId!,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          // A legacy line written before per-line assignment carries no
          // employee; the contract below rejects replaying it, as it should.
          employeeId: line.employeeId!,
        }
      : { itemType: 'product' as const, productId: line.productId!, quantity: line.quantity }),
    ...(invoice.discountKind ? {
      discount: { kind: invoice.discountKind, value: invoice.discountValue! },
    } : {}),
    ...(invoice.taxKind ? {
      tax: { kind: invoice.taxKind, value: invoice.taxValue! },
    } : {}),
    payments: payments.map(({ method, amount }) => ({ method, amount })),
  };
  // The sale contract requires a seller, and a branch transfer has none. These
  // rows are our own writes, so re-validating them buys nothing there; every
  // request-driven sale still goes through the contract.
  const reconstructed = invoice.sellerEmployeeId === null
    ? candidate
    : completeSaleSchema.parse(candidate);
  return { ...reconstructed, branchId: invoice.branchId };
};

const quoteServices = async (
  executor: Executor,
  branchId: number,
  lines: Array<{ serviceId: number; quantity: number; unitPrice: string }>,
  lockRows = false,
) => {
  const ids = [...new Set(lines.map(({ serviceId }) => serviceId))];
  const query = executor.select({
    id: erpServices.id,
    name: erpServices.name,
    price: erpServices.price,
  }).from(erpServices)
    .innerJoin(erpCategories, and(
      eq(erpCategories.id, erpServices.categoryId),
      eq(erpCategories.branchId, erpServices.branchId),
    ))
    .where(and(
      eq(erpServices.branchId, branchId),
      eq(erpServices.isActive, true),
      eq(erpCategories.isActive, true),
      eq(erpCategories.type, 'service'),
      inArray(erpServices.id, ids),
    ))
    .orderBy(asc(erpServices.id));
  const rows = lockRows ? await query.for('update') : await query;
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== ids.length) throw new SaleError('SERVICE_UNAVAILABLE');
  try {
    return lines.map((line) => {
      const service = byId.get(line.serviceId)!;
      if (service.price !== null && service.price !== line.unitPrice) {
        throw new SaleError('PRICE_CHANGED');
      }
      const unitPrice = service.price ?? line.unitPrice;
      return {
        itemType: 'service' as const,
        sourceId: service.id,
        name: service.name,
        quantity: line.quantity,
        unitPrice,
        lineTotal: calculateLineTotal(unitPrice, line.quantity),
      };
    });
  } catch (error) {
    if (error instanceof MoneyCalculationError) throw new SaleError('SALE_VALIDATION_FAILED');
    throw error;
  }
};

const quoteProducts = async (
  executor: Executor,
  branchId: number,
  lines: Array<{ productId: number; quantity: number }>,
  lock = false,
  // The shelf price, except for a transfer between branches, which moves goods
  // at what they cost so neither branch books a profit on the move.
  pricing: 'selling' | 'cost' = 'selling',
) => {
  if (!lines.length) return [];
  const ids = [...new Set(lines.map(({ productId }) => productId))].sort((left, right) => left - right);
  let query = executor.select({
    id: erpProducts.id, name: erpProducts.name, price: erpProducts.sellingPrice,
    cost: erpProducts.lastPurchaseCost, quantity: erpProductStocks.quantity,
  }).from(erpProducts).innerJoin(erpProductStocks, and(
    eq(erpProductStocks.productId, erpProducts.id),
    eq(erpProductStocks.branchId, erpProducts.branchId),
  )).where(and(eq(erpProducts.branchId, branchId), eq(erpProducts.isActive, true), inArray(erpProducts.id, ids)))
    .orderBy(asc(erpProducts.id));
  if (lock) query = query.for('update') as typeof query;
  const rows = await query;
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== ids.length) throw new SaleError('PRODUCT_UNAVAILABLE');
  const remaining = new Map(rows.map((row) => [row.id, row.quantity]));
  return lines.map((line) => {
    const product = byId.get(line.productId)!;
    const balanceBefore = remaining.get(line.productId)!;
    if (balanceBefore < line.quantity) throw new SaleError('INSUFFICIENT_STOCK');
    remaining.set(line.productId, balanceBefore - line.quantity);
    const unitPrice = pricing === 'cost' ? product.cost : product.price;
    return {
      itemType: 'product' as const, sourceId: product.id, name: product.name,
      quantity: line.quantity, unitPrice,
      lineTotal: calculateLineTotal(unitPrice, line.quantity),
      productCostBasis: product.cost, balanceBefore,
    };
  });
};

export const createDrizzleSaleRepository = (
  database: Database,
  audit: ErpAuditCapability,
  payroll?: ErpPayrollCapability,
): SaleRepository => {
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

  const repository: SaleRepository = {
    async quote(branchId, input) {
      const serviceLines = input.lines.filter((line): line is Extract<typeof line, { itemType: 'service' }> => line.itemType === 'service');
      const productLines = input.lines.filter((line): line is Extract<typeof line, { itemType: 'product' }> => line.itemType === 'product');
      const services = await quoteServices(database, branchId, serviceLines);
      const products = await quoteProducts(database, branchId, productLines);
      const byKey = keyedQueues([...services, ...products]);
      const lines = input.lines.map((line) => {
        const sourceId = line.itemType === 'service' ? line.serviceId : line.productId;
        const quoted = byKey.get(`${line.itemType}:${sourceId}`)!.shift()!;
        return { itemType: quoted.itemType, sourceId: quoted.sourceId, name: quoted.name, quantity: quoted.quantity, unitPrice: quoted.unitPrice, lineTotal: quoted.lineTotal };
      });
      let totals;
      try {
        totals = calculateSaleTotals({
          lineTotals: lines.map(({ lineTotal }) => lineTotal),
          ...(input.discount ? { discount: input.discount } : {}),
          ...(input.tax ? { tax: input.tax } : {}),
          payments: [],
        });
      } catch (error) {
        if (error instanceof MoneyCalculationError) throw new SaleError('SALE_VALIDATION_FAILED');
        throw error;
      }
      return {
        lines,
        discount: input.discount ? {
          ...input.discount,
          amount: calculateAdjustment(totals.subtotal, input.discount),
        } : null,
        tax: input.tax ? {
          ...input.tax,
          amount: calculateAdjustment(totals.subtotal, input.tax),
        } : null,
        totals: {
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          total: totals.total,
        },
      };
    },

    findByIdempotencyKey,

    async complete(operation: CompleteSaleOperation) {
      try {
        return await database.transaction(async (transaction) => {
          const { input } = operation;
          const serviceInputs = input.lines.filter((line): line is Extract<typeof line, { itemType: 'service' }> => line.itemType === 'service');
          const productInputs = input.lines.filter((line): line is Extract<typeof line, { itemType: 'product' }> => line.itemType === 'product');
          // Every service names the employee who performed it; the invoice as a
          // whole names none, so one sale can pay several people.
          const employeeIds = [...new Set(serviceInputs.map((line) => line.employeeId))]
            .sort((left, right) => left - right);
          if (serviceInputs.length && (
            employeeIds.some((employeeId) => employeeId === undefined)
            || operation.assertEmployees === undefined
          )) {
            throw new SaleError('SALE_VALIDATION_FAILED');
          }
          // A shift is spent once it passes its sixteen hours, whether or not the
          // sweep has written the close yet, so no sale can slip in behind it.
          const session = (await transaction.select().from(cashierSessions).where(and(
            eq(cashierSessions.id, input.cashierSessionId),
            eq(cashierSessions.branchId, input.branchId),
            isNull(cashierSessions.closedAt),
            // Strictly after the limit: the sweep spends a shift that reaches it.
            gt(
              cashierSessions.openedAt,
              new Date(operation.soldAt.getTime() - CASHIER_SESSION_MAX_DURATION_MS),
            ),
          )).for('update').limit(1))[0];
          if (!session || (operation.actingAccountRole === 'cashier'
            && session.openedByAccountId !== operation.actingAccountId)) {
            throw new SaleError('CASHIER_SESSION_NOT_OPEN');
          }
          if (payroll) {
            // Ascending order, so two concurrent sales sharing employees queue
            // behind each other instead of deadlocking.
            for (const employeeId of employeeIds) {
              await payroll.lockCommissionEmployee(employeeId, transaction);
            }
          }

          const client = (await transaction.select().from(clients).where(and(
            eq(clients.id, input.clientId),
            eq(clients.branchId, input.branchId),
          )).limit(1))[0];
          if (!client) throw new SaleError('CLIENT_NOT_FOUND');
          const account = (await transaction.select({
            username: accounts.username,
            role: accounts.role,
            employeeId: accounts.employeeId,
            active: accounts.active,
          }).from(accounts).where(eq(accounts.id, operation.actingAccountId))
            .for('update').limit(1))[0];
          if (!account || !account.active || account.role !== operation.actingAccountRole) {
            throw new SaleError('CASHIER_SESSION_NOT_OPEN');
          }
          // The seller must still be on the branch roster when the sale settles.
          // A transfer between branches has none: no person sold anything, and
          // products earn no commission, so the invoice records no seller.
          const seller = input.sellerEmployeeId === undefined ? null
            : (await transaction.select({
              id: employees.id,
              fullName: employees.fullName,
            }).from(branchCashierRoster).innerJoin(employees, and(
              eq(employees.id, branchCashierRoster.employeeId),
              eq(employees.branchId, branchCashierRoster.branchId),
            )).where(and(
              eq(branchCashierRoster.branchId, input.branchId),
              eq(branchCashierRoster.employeeId, input.sellerEmployeeId),
              eq(employees.employmentStatus, 'active'),
              isNull(employees.deletedAt),
            )).for('update').limit(1))[0];
          if (input.sellerEmployeeId !== undefined && !seller) {
            throw new SaleError('SELLER_NOT_ON_ROSTER');
          }
          const assignedEmployees = serviceInputs.length
            ? await operation.assertEmployees!(transaction)
            : [];
          const employeeById = new Map(assignedEmployees.map((row) => [row.id, row]));
          const quotedLines = await quoteServices(transaction, input.branchId, serviceInputs, true);
          const quotedProducts = await quoteProducts(
            transaction, input.branchId, productInputs, true, operation.pricing,
          );
          const serviceIds = [...new Set(serviceInputs.map(({ serviceId }) => serviceId))];
          const serviceRows = serviceIds.length ? await transaction.select({
            id: erpServices.id,
            commissionPercent: erpServices.commissionPercent,
          }).from(erpServices).where(inArray(erpServices.id, serviceIds)) : [];
          // An override belongs to one employee, so the same service can pay two
          // different rates on the same invoice.
          const overrides = serviceIds.length ? await transaction.select().from(erpServiceCommissionOverrides)
            .where(and(
              inArray(erpServiceCommissionOverrides.serviceId, serviceIds),
              inArray(erpServiceCommissionOverrides.employeeId, employeeIds),
            )) : [];
          const defaultRates = new Map(serviceRows.map((service) => [
            service.id, service.commissionPercent,
          ]));
          const overrideRates = new Map(overrides.map((override) => [
            `${override.serviceId}:${override.employeeId}`, override.commissionPercent,
          ]));
          const calculatedServices = quotedLines.map((line, index) => {
            const employee = employeeById.get(serviceInputs[index]!.employeeId)!;
            const override = overrideRates.get(`${line.sourceId}:${employee.id}`);
            const rule = override === undefined ? 'service_default' as const : 'employee_override' as const;
            const rate = override ?? defaultRates.get(line.sourceId)!;
            return {
              ...line,
              employee,
              commissionRule: rule,
              commissionRate: rate,
              commissionAmount: calculateCommission(line.lineTotal, rate),
            };
          });
          const calculatedProducts = quotedProducts.map((line) => ({
            ...line,
            employee: null,
            commissionRule: 'none' as const,
            commissionRate: '0.00',
            commissionAmount: '0.00',
          }));
          const byKey = keyedQueues([...calculatedServices, ...calculatedProducts]);
          const calculatedLines = input.lines.map((line) => byKey.get(`${line.itemType}:${line.itemType === 'service' ? line.serviceId : line.productId}`)!.shift()!);
          let totals;
          try {
            totals = calculateSaleTotals({
              lineTotals: calculatedLines.map(({ lineTotal }) => lineTotal),
              ...(input.discount ? { discount: input.discount } : {}),
              ...(input.tax ? { tax: input.tax } : {}),
              payments: input.payments,
            });
          } catch (error) {
            if (error instanceof MoneyCalculationError) {
              throw new SaleError('SALE_VALIDATION_FAILED');
            }
            throw error;
          }
          if (toCents(totals.paymentTotal) > toCents(totals.total)) {
            throw new SaleError('PAYMENT_TOTAL_MISMATCH');
          }
          if (serviceInputs.length && totals.paymentTotal !== totals.total) {
            throw new SaleError('PARTIAL_PAYMENT_NOT_ALLOWED_WITH_SERVICES');
          }

          const inserted = await transaction.insert(invoices).values({
            branchId: input.branchId,
            clientId: input.clientId,
            sellerEmployeeId: seller?.id ?? null,
            actingAccountId: operation.actingAccountId,
            cashierSessionId: input.cashierSessionId,
            invoiceNumber: operation.invoiceNumber,
            idempotencyKey: input.idempotencyKey,
            kind: operation.kind ?? 'sale',
            clientNameSnapshot: client.fullName,
            clientPhoneSnapshot: client.phone,
            sellerNameSnapshot: seller?.fullName ?? null,
            authorizedBySnapshot: account.username,
            subtotal: totals.subtotal,
            discountKind: input.discount?.kind ?? null,
            discountValue: input.discount?.value ?? null,
            discountAmount: totals.discountAmount,
            taxKind: input.tax?.kind ?? null,
            taxValue: input.tax?.value ?? null,
            taxAmount: totals.taxAmount,
            total: totals.total,
            amountPaid: totals.paymentTotal,
            settlementStatus: totals.paymentTotal === totals.total ? 'settled' : 'open',
            soldAt: operation.soldAt,
            createdAt: operation.soldAt,
          });
          const invoiceId = Number(inserted[0].insertId);
          for (const [index, line] of calculatedLines.entries()) {
            const insertedLine = await transaction.insert(invoiceLines).values({
              invoiceId,
              branchId: input.branchId,
              lineNumber: index + 1,
              itemType: line.itemType,
              serviceId: line.itemType === 'service' ? line.sourceId : null,
              productId: line.itemType === 'product' ? line.sourceId : null,
              itemNameSnapshot: line.name,
              employeeId: line.employee?.id ?? null,
              employeeNameSnapshot: line.employee?.fullName ?? null,
              employeeCodeSnapshot: line.employee?.employeeCode ?? null,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
              commissionRuleSnapshot: line.commissionRule,
              commissionRateSnapshot: line.commissionRate,
              commissionAmountSnapshot: line.commissionAmount,
              productCostBasisSnapshot: line.itemType === 'product' ? line.productCostBasis : null,
            });
            const invoiceLineId = Number(insertedLine[0].insertId);
            if (line.itemType === 'service') {
              await transaction.insert(commissionLedgerEntries).values({
                invoiceId, invoiceLineId, employeeId: line.employee.id,
                actingAccountId: operation.actingAccountId, entryType: 'earned',
                commissionRuleSnapshot: line.commissionRule, commissionRateSnapshot: line.commissionRate,
                baseAmount: line.lineTotal, amount: line.commissionAmount, createdAt: operation.soldAt,
              });
            } else {
              const balanceAfter = line.balanceBefore - line.quantity;
              await transaction.update(erpProductStocks).set({ quantity: balanceAfter, updatedAt: operation.soldAt }).where(and(
                eq(erpProductStocks.productId, line.sourceId), eq(erpProductStocks.branchId, input.branchId),
              ));
              await transaction.insert(erpStockMovements).values({
                productId: line.sourceId, branchId: input.branchId, reason: 'sale', sourceType: 'sale', sourceId: invoiceId,
                quantityDelta: -line.quantity, balanceAfter, actingAccountId: operation.actingAccountId, createdAt: operation.soldAt,
              });
            }
          }
          if (input.payments.length > 0) await transaction.insert(invoicePayments).values(input.payments.map((payment) => ({
            invoiceId,
            method: payment.method,
            amount: payment.amount,
            operationReference: randomUUID(),
            isInitial: true,
            // Money is attributed to the shift and the account that took it, so a
            // later instalment can belong to a later shift than the invoice.
            cashierSessionId: input.cashierSessionId,
            actingAccountId: operation.actingAccountId,
            paidAt: operation.soldAt,
            createdAt: operation.soldAt,
          })));
          const amountPaid = input.payments.reduce((sum, payment) => sum + toCents(payment.amount), 0n);
          await transaction.update(invoices).set({
            status: 'completed',
            amountPaid: signedMoney(amountPaid),
            settlementStatus: amountPaid === toCents(totals.total) ? 'settled' : 'open',
          })
            .where(eq(invoices.id, invoiceId));
          for (const employeeId of employeeIds) {
            await projectCommission(transaction, employeeId, cairoMonth(operation.soldAt));
          }
          const completed = await hydrateInvoice(transaction, invoiceId);
          if (!completed) throw new Error('Completed invoice could not be reloaded');
          await audit.record(transaction, {
            module: 'erp-sales',
            action: 'complete',
            entityType: 'invoice',
            entityId: invoiceId,
            afterState: completed,
            relatedIds: {
              branchId: input.branchId,
              clientId: input.clientId,
              ...(employeeIds.length ? { employeeIds: employeeIds.join(',') } : {}),
              ...(seller ? { sellerEmployeeId: seller.id } : {}),
              cashierSessionId: input.cashierSessionId,
            },
            createdAt: operation.soldAt,
          });
          // The receiving branch of a transfer settles here, so the sale and the
          // stock it moved either both commit or both roll back.
          await operation.afterInvoice?.(transaction, completed);
          return completed;
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        const existing = await findByIdempotencyKey(operation.input.idempotencyKey, {
          actingAccountId: operation.actingAccountId,
          actingAccountRole: operation.actingAccountRole,
        });
        if (!existing) throw new SaleError('IDEMPOTENCY_CONFLICT');
        if (!isDeepStrictEqual(existing.input, operation.input)) {
          throw new SaleError('IDEMPOTENCY_CONFLICT');
        }
        return existing.invoice;
      }
    },

    async recordPayment(operation: RecordInvoicePaymentOperation) {
      return database.transaction(async (transaction) => {
        const original = (await transaction.select().from(invoices).where(and(
          eq(invoices.id, operation.invoiceId),
          eq(invoices.branchId, operation.input.branchId),
        )).for('update').limit(1))[0];
        if (!original || original.status === 'draft') throw new SaleError('INVOICE_NOT_FOUND');

        const existing = (await transaction.select().from(invoicePayments).where(and(
          eq(invoicePayments.invoiceId, original.id),
          eq(invoicePayments.operationReference, operation.input.operationReference),
        )).limit(1))[0];
        if (existing) {
          if (existing.method !== operation.input.method || existing.amount !== operation.input.amount) {
            throw new SaleError('IDEMPOTENCY_CONFLICT');
          }
          const replayed = await hydrateInvoice(transaction, original.id);
          if (!replayed) throw new SaleError('INVOICE_NOT_FOUND');
          return replayed;
        }
        if (!['completed', 'partially_refunded'].includes(original.status)) {
          throw new SaleError('INVOICE_NOT_REVERSIBLE');
        }
        const hasService = (await transaction.select({ id: invoiceLines.id }).from(invoiceLines)
          .where(and(eq(invoiceLines.invoiceId, original.id), eq(invoiceLines.itemType, 'service')))
          .limit(1))[0];
        if (hasService) throw new SaleError('PARTIAL_PAYMENT_NOT_ALLOWED_WITH_SERVICES');
        if (toCents(operation.input.amount) > toCents(original.balanceDue!)) {
          throw new SaleError('PAYMENT_EXCEEDS_BALANCE');
        }
        const session = (await transaction.select().from(cashierSessions).where(and(
          eq(cashierSessions.id, operation.input.cashierSessionId),
          eq(cashierSessions.branchId, operation.input.branchId),
          isNull(cashierSessions.closedAt),
          gt(cashierSessions.openedAt,
            new Date(operation.paidAt.getTime() - CASHIER_SESSION_MAX_DURATION_MS)),
        )).for('update').limit(1))[0];
        if (!session || (operation.actingAccountRole === 'cashier'
          && session.openedByAccountId !== operation.actingAccountId)) {
          throw new SaleError('CASHIER_SESSION_NOT_OPEN');
        }
        const beforeState = await hydrateInvoice(transaction, original.id);
        await transaction.insert(invoicePayments).values({
          invoiceId: original.id,
          method: operation.input.method,
          amount: operation.input.amount,
          operationReference: operation.input.operationReference,
          isInitial: false,
          cashierSessionId: session.id,
          actingAccountId: operation.actingAccountId,
          paidAt: operation.paidAt,
          createdAt: operation.paidAt,
        });
        const amountPaid = signedMoney(
          toCents(original.amountPaid) + toCents(operation.input.amount),
        );
        await transaction.update(invoices).set({
          amountPaid,
          settlementStatus: toCents(amountPaid) + toCents(original.creditedAmount) === toCents(original.total)
            ? 'settled' : 'open',
        }).where(eq(invoices.id, original.id));
        const afterState = await hydrateInvoice(transaction, original.id);
        if (!afterState) throw new SaleError('INVOICE_NOT_FOUND');
        await audit.record(transaction, {
          module: 'erp-sales', action: 'record_payment', entityType: 'invoice',
          entityId: original.id, beforeState, afterState,
          relatedIds: { branchId: original.branchId, cashierSessionId: session.id },
          createdAt: operation.paidAt,
        });
        return afterState;
      });
    },

    async reassignLine(operation: ReassignInvoiceLineOperation) {
      const existing = await existingReassignment(operation);
      if (existing) return existing;
      try {
        return await database.transaction(async (transaction) => {
          const invoice = (await transaction.select().from(invoices).where(and(
            eq(invoices.id, operation.invoiceId),
            eq(invoices.branchId, operation.input.branchId),
          )).for('update').limit(1))[0];
          if (!invoice) throw new SaleError('INVOICE_NOT_FOUND');
          if (invoice.status !== 'completed') throw new SaleError('INVOICE_NOT_REASSIGNABLE');
          const committedRetry = await existingReassignment(operation, transaction);
          if (committedRetry) return committedRetry;
          const line = (await transaction.select().from(invoiceLines).where(and(
            eq(invoiceLines.id, operation.invoiceLineId),
            eq(invoiceLines.invoiceId, operation.invoiceId),
            eq(invoiceLines.branchId, operation.input.branchId),
          )).for('update').limit(1))[0];
          if (!line) throw new SaleError('INVOICE_NOT_FOUND');
          if (line.itemType !== 'service' || line.employeeId === null
            || line.commissionRuleSnapshot === 'none') {
            throw new SaleError('REASSIGN_LINE_NOT_SERVICE');
          }
          const prior = (await transaction.select().from(invoiceLineReassignments).where(
            eq(invoiceLineReassignments.invoiceLineId, line.id),
          ).orderBy(desc(invoiceLineReassignments.createdAt), desc(invoiceLineReassignments.id))
            .limit(1))[0];
          const fromEmployeeId = prior?.toEmployeeId ?? line.employeeId;
          if (fromEmployeeId === operation.input.employeeId) {
            throw new SaleError('REASSIGN_SAME_EMPLOYEE');
          }
          const target = await operation.assertEmployee(transaction);
          const employeeIds = [fromEmployeeId, target.id].sort((left, right) => left - right);
          if (payroll) {
            for (const employeeId of employeeIds) {
              await payroll.lockCommissionEmployee(employeeId, transaction);
            }
          }
          const inserted = await transaction.insert(invoiceLineReassignments).values({
            invoiceId: invoice.id,
            invoiceLineId: line.id,
            branchId: invoice.branchId,
            fromEmployeeId,
            toEmployeeId: target.id,
            reason: operation.input.reason,
            operationReference: operation.input.operationReference,
            actingAccountId: operation.actingAccountId,
            createdAt: operation.reassignedAt,
          });
          const reassignmentId = Number(inserted[0].insertId);
          const ledgerBase = {
            invoiceId: invoice.id,
            invoiceLineId: line.id,
            actingAccountId: operation.actingAccountId,
            invoiceLineReassignmentId: reassignmentId,
            commissionRuleSnapshot: line.commissionRuleSnapshot,
            commissionRateSnapshot: line.commissionRateSnapshot,
            baseAmount: line.lineTotal,
            createdAt: operation.reassignedAt,
          };
          await transaction.insert(commissionLedgerEntries).values({
            ...ledgerBase,
            employeeId: fromEmployeeId,
            entryType: 'reassignment_out' as const,
            amount: signedMoney(-toCents(line.commissionAmountSnapshot)),
          });
          await transaction.insert(commissionLedgerEntries).values({
            ...ledgerBase,
            employeeId: target.id,
            entryType: 'reassignment_in' as const,
            amount: line.commissionAmountSnapshot,
          });
          for (const employeeId of employeeIds) {
            const result = await projectCommission(
              transaction, employeeId, cairoMonth(invoice.soldAt),
            );
            if (result === 'payroll_finalized'
              || result === 'payroll_finalized_without_commission') {
              throw new SaleError('REASSIGN_PAYROLL_FINALIZED');
            }
          }
          const afterState = await hydrateInvoice(transaction, invoice.id);
          if (!afterState) throw new SaleError('INVOICE_NOT_FOUND');
          await audit.record(transaction, {
            module: 'erp-sales', action: 'reassign_employee',
            entityType: 'invoice_line', entityId: line.id,
            afterState,
            relatedIds: {
              invoiceId: invoice.id, branchId: invoice.branchId,
              fromEmployeeId, toEmployeeId: target.id,
            },
            createdAt: operation.reassignedAt,
          });
          return afterState;
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        const replay = await existingReassignment(operation);
        if (!replay) throw new SaleError('IDEMPOTENCY_CONFLICT');
        return replay;
      }
    },

    async reverse(operation: ReverseInvoiceOperation) {
      const existing = await existingReversal(operation);
      if (existing) return existing;
      // Read outside the transaction: a completed invoice's lines never change,
      // and a read inside would either freeze this transaction's snapshot before
      // the payroll lock or add line locks that deadlock concurrent reversals.
      const invoiceEmployeeIds = [...new Set((await database
        .select({ employeeId: invoiceLines.employeeId }).from(invoiceLines)
        .where(and(
          eq(invoiceLines.invoiceId, operation.invoiceId),
          eq(invoiceLines.branchId, operation.input.branchId),
          isNotNull(invoiceLines.employeeId),
        ))).map(({ employeeId }) => employeeId!))];
      const reassignedEmployeeIds = (await database.select({
        employeeId: invoiceLineReassignments.toEmployeeId,
      }).from(invoiceLineReassignments).where(
        eq(invoiceLineReassignments.invoiceId, operation.invoiceId),
      )).map(({ employeeId }) => employeeId);
      const commissionEmployeeIds = [...new Set([
        ...invoiceEmployeeIds, ...reassignedEmployeeIds,
      ])].sort((left, right) => left - right);
      try {
        return await database.transaction(async (transaction) => {
          const original = (await transaction.select().from(invoices).where(and(
            eq(invoices.id, operation.invoiceId),
            eq(invoices.branchId, operation.input.branchId),
            ne(invoices.status, 'draft'),
          )).for('update').limit(1))[0];
          if (!original) throw new SaleError('INVOICE_NOT_FOUND');
          // Reversing internal trade would return the stock to the sending
          // branch while the receiving branch keeps it: stock from nothing.
          if (original.kind !== 'sale') throw new SaleError('TRANSFER_NOT_REVERSIBLE');
          if (payroll) {
            for (const employeeId of commissionEmployeeIds) {
              await payroll.lockCommissionEmployee(employeeId, transaction);
            }
          }
          const replay = await existingReversal(operation, transaction);
          if (replay) return replay;
          if (original.status === 'refunded' || original.status === 'voided'
            || (operation.type === 'void' && original.status !== 'completed')) {
            throw new SaleError('INVOICE_NOT_REVERSIBLE');
          }
          if (operation.type === 'void'
            && invoiceBusinessDate(original.invoiceNumber) !== cairoDate(operation.reversedAt)) {
            throw new SaleError('VOID_DATE_EXPIRED');
          }
          if (operation.type === 'void' && original.settlementStatus === 'open'
            && original.amountPaid !== '0.00') {
            throw new SaleError('INVOICE_NOT_VOIDABLE_WHEN_PARTIALLY_PAID');
          }

          const account = (await transaction.select({
            role: accounts.role, branchId: accounts.branchId, active: accounts.active,
          }).from(accounts).where(eq(accounts.id, operation.actingAccountId))
            .for('update').limit(1))[0];
          if (!account || !account.active || account.role !== operation.actingAccountRole) {
            throw new SaleError('INVOICE_NOT_REVERSIBLE');
          }
          if (operation.actingAccountRole === 'cashier'
            && account.branchId !== operation.input.branchId) {
            throw new SaleError('INVOICE_NOT_REVERSIBLE');
          }

          const originalLines = await transaction.select().from(invoiceLines)
            .where(eq(invoiceLines.invoiceId, original.id)).orderBy(asc(invoiceLines.lineNumber));
          const priorLines = await transaction.select({
            invoiceLineId: invoiceReversalLines.invoiceLineId,
            quantity: invoiceReversalLines.quantity,
          }).from(invoiceReversalLines).innerJoin(
            invoiceReversals,
            eq(invoiceReversals.id, invoiceReversalLines.reversalId),
          ).where(and(
            eq(invoiceReversalLines.invoiceId, original.id),
            eq(invoiceReversals.status, 'finalized'),
          ));
          const refundedByLine = new Map<number, number>();
          for (const line of priorLines) {
            refundedByLine.set(
              line.invoiceLineId,
              (refundedByLine.get(line.invoiceLineId) ?? 0) + line.quantity,
            );
          }
          const selected = operation.type === 'void'
            ? originalLines.map((line) => ({ invoiceLineId: line.id, quantity: line.quantity }))
            : operation.input.lines;
          let allocation;
          try {
            allocation = allocateReversalAmounts({
              lines: originalLines.map((line) => ({
                invoiceLineId: line.id, quantity: line.quantity, unitPrice: line.unitPrice,
                refundedQuantity: refundedByLine.get(line.id) ?? 0,
              })),
              selected,
              discountAmount: original.discountAmount,
              taxAmount: original.taxAmount,
            });
          } catch (error) {
            if (error instanceof MoneyCalculationError) {
              throw new SaleError('REFUND_QUANTITY_EXCEEDED');
            }
            throw error;
          }

          const originalPayments = await transaction.select().from(invoicePayments)
            .where(eq(invoicePayments.invoiceId, original.id)).orderBy(asc(invoicePayments.id));
          const priorPayments = await transaction.select({
            invoicePaymentId: invoiceReversalPayments.invoicePaymentId,
            cashAmount: invoiceReversalPayments.cashAmount,
          }).from(invoiceReversalPayments).innerJoin(
            invoiceReversals,
            eq(invoiceReversals.id, invoiceReversalPayments.reversalId),
          ).where(and(
            eq(invoiceReversals.invoiceId, original.id),
            eq(invoiceReversals.status, 'finalized'),
          ));
          const reversedByPayment = new Map<number, bigint>();
          for (const payment of priorPayments) {
            if (payment.invoicePaymentId === null) continue;
            reversedByPayment.set(
              payment.invoicePaymentId,
              (reversedByPayment.get(payment.invoicePaymentId) ?? 0n) + toCents(payment.cashAmount),
            );
          }
          const voidPaymentByMethod = new Map<typeof originalPayments[number]['method'], bigint>();
          for (const payment of originalPayments) {
            voidPaymentByMethod.set(
              payment.method,
              (voidPaymentByMethod.get(payment.method) ?? 0n) + toCents(payment.amount),
            );
          }
          const requestedPayments = operation.type === 'void'
            ? [...voidPaymentByMethod].map(([method, amount]) => ({ method, amount: signedMoney(amount) }))
            : operation.input.payments;
          const cashPayoutCents = toCents(allocation.total) > toCents(original.balanceDue!)
            ? toCents(allocation.total) - toCents(original.balanceDue!)
            : 0n;
          if (sumMoney(requestedPayments.map(({ amount }) => amount))
            !== signedMoney(cashPayoutCents)) {
            throw new SaleError('REFUND_PAYMENT_MISMATCH');
          }
          const debtCreditCents = toCents(allocation.total) - cashPayoutCents;
          const allocatedPayments = requestedPayments.length
            ? requestedPayments.map((payment, index) => ({
              ...payment,
              cashAmount: payment.amount,
              amount: index === 0
                ? signedMoney(toCents(payment.amount) + debtCreditCents)
                : payment.amount,
            }))
            : [{ method: 'cash' as const, amount: allocation.total, cashAmount: '0.00' }];
          // How the money physically goes back is the cashier's call, so any method
          // is accepted and only the total is checked. A refund is still linked to
          // the payment it reverses whenever it matches one and fits inside what is
          // left on it, which keeps the per-payment refundable accounting exact.
          const paymentRows = allocatedPayments.flatMap((requested) => {
            let remainingCash = toCents(requested.cashAmount);
            const rows: Array<{ invoicePaymentId: number | null; method: typeof requested.method; amount: string; cashAmount: string }> = [];
            for (const payment of originalPayments.filter(({ method }) => method === requested.method)) {
              const remaining = toCents(payment.amount) - (reversedByPayment.get(payment.id) ?? 0n);
              const linkedCents = remainingCash < remaining ? remainingCash : remaining;
              if (linkedCents <= 0n) continue;
              reversedByPayment.set(payment.id, (reversedByPayment.get(payment.id) ?? 0n) + linkedCents);
              rows.push({ invoicePaymentId: payment.id, method: requested.method, amount: signedMoney(linkedCents), cashAmount: signedMoney(linkedCents) });
              remainingCash -= linkedCents;
              if (remainingCash === 0n) break;
            }
            const linkedCash = toCents(requested.cashAmount) - remainingCash;
            const remainderAmount = toCents(requested.amount) - linkedCash;
            if (remainderAmount > 0n || rows.length === 0) {
              rows.push({
                invoicePaymentId: null,
                method: requested.method,
                amount: signedMoney(remainderAmount),
                cashAmount: signedMoney(remainingCash),
              });
            }
            return rows;
          });

          const beforeState = await hydrateInvoice(transaction, original.id);
          // The money goes back out of whichever till is open now, which is not the
          // till that sold the invoice. An admin may refund with no till open at
          // all, and a shift past its sixteen hours is spent whether or not the
          // sweep has written its close, so both cases leave this null.
          const payingSession = (await transaction.select({ id: cashierSessions.id })
            .from(cashierSessions).where(and(
              eq(cashierSessions.branchId, original.branchId),
              isNull(cashierSessions.closedAt),
              gt(
                cashierSessions.openedAt,
                new Date(operation.reversedAt.getTime() - CASHIER_SESSION_MAX_DURATION_MS),
              ),
            )).limit(1))[0];

          const inserted = await transaction.insert(invoiceReversals).values({
            invoiceId: original.id,
            branchId: original.branchId,
            cashierSessionId: payingSession?.id ?? null,
            type: operation.type,
            idempotencyKey: operation.input.idempotencyKey,
            reason: operation.input.reason,
            actingAccountId: operation.actingAccountId,
            approvingAccountId: null,
            grossAmount: allocation.grossAmount,
            discountAmount: allocation.discountAmount,
            taxAmount: allocation.taxAmount,
            total: allocation.total,
            businessDate: cairoDate(operation.reversedAt),
            createdAt: operation.reversedAt,
          });
          const reversalId = Number(inserted[0].insertId);
          await transaction.insert(invoiceReversalLines).values(allocation.lines.map((line) => ({
            reversalId,
            invoiceId: original.id,
            invoiceLineId: line.invoiceLineId,
            branchId: original.branchId,
            quantity: line.quantity,
            grossAmount: line.grossAmount,
            discountAmount: line.discountAmount,
            taxAmount: line.taxAmount,
            total: line.total,
          })));
          if (paymentRows.length) {
            const reversalPaymentValues = paymentRows
              .filter((payment) => toCents(payment.amount) > 0n)
              .map((payment) => ({
              reversalId,
              invoiceId: operation.invoiceId,
                invoicePaymentId: payment.invoicePaymentId,
                methodSnapshot: payment.method,
                amount: payment.amount,
                cashAmount: payment.cashAmount,
              }));
            if (reversalPaymentValues.length) {
              await transaction.insert(invoiceReversalPayments).values(reversalPaymentValues);
            }
          }

          const selectedByLine = new Map(selected.map((line) => [line.invoiceLineId, line.quantity]));
          const productLines = originalLines.filter((line) => (
            line.itemType === 'product' && selectedByLine.has(line.id)
          )).sort((left, right) => left.productId! - right.productId!);
          if (productLines.length) {
            const productIds = [...new Set(productLines.map((line) => line.productId!))];
            const stocks = await transaction.select().from(erpProductStocks).where(and(
              eq(erpProductStocks.branchId, original.branchId),
              inArray(erpProductStocks.productId, productIds),
            )).orderBy(asc(erpProductStocks.productId)).for('update');
            const balanceByProduct = new Map(stocks.map((stock) => [stock.productId, stock.quantity]));
            for (const line of productLines) {
              const quantity = selectedByLine.get(line.id)!;
              const balanceBefore = balanceByProduct.get(line.productId!);
              if (balanceBefore === undefined) throw new SaleError('PRODUCT_UNAVAILABLE');
              const balanceAfter = balanceBefore + quantity;
              balanceByProduct.set(line.productId!, balanceAfter);
              await transaction.update(erpProductStocks).set({
                quantity: balanceAfter, updatedAt: operation.reversedAt,
              }).where(and(
                eq(erpProductStocks.productId, line.productId!),
                eq(erpProductStocks.branchId, original.branchId),
              ));
              await transaction.insert(erpStockMovements).values({
                productId: line.productId!, branchId: original.branchId,
                reason: operation.type, sourceType: operation.type, sourceId: reversalId,
                quantityDelta: quantity, balanceAfter,
                actingAccountId: operation.actingAccountId, createdAt: operation.reversedAt,
              });
            }
          }

          const ledger = await transaction.select().from(commissionLedgerEntries)
            .where(eq(commissionLedgerEntries.invoiceId, original.id));
          const assignmentHistory = await transaction.select().from(invoiceLineReassignments)
            .where(eq(invoiceLineReassignments.invoiceId, original.id))
            .orderBy(desc(invoiceLineReassignments.createdAt), desc(invoiceLineReassignments.id));
          const finalizedReversalIds = new Set((await transaction.select({ id: invoiceReversals.id })
            .from(invoiceReversals).where(and(
              eq(invoiceReversals.invoiceId, original.id),
              eq(invoiceReversals.status, 'finalized'),
            ))).map(({ id }) => id));
          // Reversed commission is owed back per employee: each service line
          // takes it from whoever earned it.
          const reversedByEmployee = new Map<number, bigint>();
          for (const line of originalLines.filter((candidate) => (
            candidate.itemType === 'service' && selectedByLine.has(candidate.id)
          ))) {
            const currentAssignment = assignmentHistory.find((entry) => (
              entry.invoiceLineId === line.id
            ));
            const earned = currentAssignment
              ? ledger.find((entry) => (
                entry.invoiceLineReassignmentId === currentAssignment.id
                && entry.entryType === 'reassignment_in'
              ))!
              : ledger.find((entry) => (
                entry.invoiceLineId === line.id && entry.entryType === 'earned'
              ))!;
            const priorBase = ledger.filter((entry) => (
              entry.reversesEntryId === earned.id
              && entry.invoiceReversalId !== null
              && finalizedReversalIds.has(entry.invoiceReversalId)
            ))
              .reduce((sum, entry) => sum + toCents(entry.baseAmount), 0n);
            const base = toCents(line.unitPrice) * BigInt(selectedByLine.get(line.id)!);
            const amount = commissionCents(priorBase + base, earned.commissionRateSnapshot)
              - commissionCents(priorBase, earned.commissionRateSnapshot);
            const lineEmployeeId = earned.employeeId;
            reversedByEmployee.set(
              lineEmployeeId,
              (reversedByEmployee.get(lineEmployeeId) ?? 0n) + amount,
            );
            await transaction.insert(commissionLedgerEntries).values({
              invoiceId: original.id,
              invoiceLineId: line.id,
              employeeId: lineEmployeeId,
              actingAccountId: operation.actingAccountId,
              entryType: 'reversal',
              reversesEntryId: earned.id,
              invoiceReversalId: reversalId,
              commissionRuleSnapshot: earned.commissionRuleSnapshot,
              commissionRateSnapshot: earned.commissionRateSnapshot,
              baseAmount: signedMoney(base),
              amount: signedMoney(-amount),
              createdAt: operation.reversedAt,
            });
          }

          await transaction.update(invoiceReversals).set({ status: 'finalized' })
            .where(eq(invoiceReversals.id, reversalId));

          if (payroll) {
            const month = cairoMonth(original.soldAt);
            for (const employeeId of [...reversedByEmployee.keys()]
              .sort((left, right) => left - right)) {
              const reversedCommission = reversedByEmployee.get(employeeId)!;
              if (reversedCommission <= 0n) continue;
              const projection = await projectCommission(transaction, employeeId, month);
              if (projection === 'payroll_finalized') {
                await payroll.recordPostPayrollDeduction({
                  employeeId,
                  occurredAt: operation.reversedAt,
                  amount: signedMoney(reversedCommission),
                  reference: `erp-commission-reversal:${reversalId}:${employeeId}`,
                }, transaction);
              }
            }
          }

          const afterState = await hydrateInvoice(transaction, original.id);
          if (!beforeState || !afterState) throw new Error('Reversed invoice could not be reloaded');
          await audit.record(transaction, {
            module: 'erp-sales', action: operation.type, entityType: 'invoice',
            entityId: original.id, beforeState, afterState,
            relatedIds: {
              branchId: original.branchId,
              reversalId,
              actingAccountId: operation.actingAccountId,
            },
            createdAt: operation.reversedAt,
          });
          return afterState;
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        const existingAfterRace = await existingReversal(operation);
        if (!existingAfterRace) throw new SaleError('IDEMPOTENCY_CONFLICT');
        return existingAfterRace;
      }
    },

    async listClientVisits(branchId, clientId, query) {
      const client = (await database.select({ id: clients.id }).from(clients).where(and(
        eq(clients.id, clientId),
        eq(clients.branchId, branchId),
      )).limit(1))[0];
      if (!client) throw new SaleError('CLIENT_NOT_FOUND');
      const where = and(
        eq(invoices.branchId, branchId),
        eq(invoices.clientId, clientId),
        ne(invoices.status, 'draft'),
      );
      const [{ total = 0 } = { total: 0 }] = await database.select({ total: count() })
        .from(invoices).where(where);
      const rows = await database.select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        total: invoices.total,
        soldAt: invoices.soldAt,
      }).from(invoices).where(where).orderBy(desc(invoices.soldAt), desc(invoices.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      const employeesByInvoice = await listInvoiceEmployees(rows.map(({ id }) => id));
      return {
        items: rows.map((row) => ({
          id: row.id,
          invoiceNumber: row.invoiceNumber,
          status: row.status as Exclude<typeof row.status, 'draft'>,
          total: row.total,
          employees: employeesByInvoice.get(row.id) ?? [],
          soldAt: asIso(row.soldAt),
        })),
        total,
      };
    },

    async listInvoices(branchId, query) {
      const escapedSearch = query.search?.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
      const where = and(
        eq(invoices.branchId, branchId),
        ne(invoices.status, 'draft'),
        escapedSearch ? or(
          like(invoices.invoiceNumber, `%${escapedSearch}%`),
          like(invoices.clientNameSnapshot, `%${escapedSearch}%`),
          like(invoices.clientPhoneSnapshot, `%${escapedSearch}%`),
        ) : undefined,
      );
      const [{ total = 0 } = { total: 0 }] = await database.select({ total: count() })
        .from(invoices).where(where);
      const rows = await database.select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        balanceDue: invoices.balanceDue,
        settlementStatus: invoices.settlementStatus,
        clientId: invoices.clientId,
        clientName: invoices.clientNameSnapshot,
        clientPhone: invoices.clientPhoneSnapshot,
        soldAt: invoices.soldAt,
      }).from(invoices).where(where).orderBy(desc(invoices.soldAt), desc(invoices.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      const employeesByInvoice = await listInvoiceEmployees(rows.map(({ id }) => id));
      return {
        items: rows.map((row) => ({
          id: row.id,
          invoiceNumber: row.invoiceNumber,
          status: row.status as Exclude<typeof row.status, 'draft'>,
          total: row.total,
          amountPaid: row.amountPaid,
          balanceDue: row.balanceDue!,
          settlementStatus: row.settlementStatus,
          client: { id: row.clientId, name: row.clientName, phone: row.clientPhone },
          employees: employeesByInvoice.get(row.id) ?? [],
          soldAt: asIso(row.soldAt),
        })),
        total,
      };
    },

    async findInvoiceById(branchId, invoiceId) {
      const row = (await database.select({ id: invoices.id }).from(invoices).where(and(
        eq(invoices.id, invoiceId),
        eq(invoices.branchId, branchId),
        ne(invoices.status, 'draft'),
      )).limit(1))[0];
      return row ? hydrateInvoice(database, row.id) : null;
    },

  };
  return repository;
};
