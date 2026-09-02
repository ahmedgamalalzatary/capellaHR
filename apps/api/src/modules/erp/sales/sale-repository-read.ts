import { completeSaleSchema } from '@capella/contracts';
import { type createDatabase } from '@capella/database';
import {
  accounts, employees, erpBookings, erpCategories, erpProducts, erpProductStocks,
  erpServices, invoiceLines, invoiceLineReassignments, invoicePayments,
  invoiceReversalLines, invoiceReversalPayments, invoiceReversals, invoices,
  serviceQueueEntries,
} from '@capella/database/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { SaleError, type SaleRepository } from './sale-service.js';
import {
  calculateAdjustment,
  calculateLineTotal,
  calculateSaleTotals,
  MoneyCalculationError,
  sumMoney,
  toCents,
} from './services/sale-calculations.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

const asIso = (value: Date) => value.toISOString();
const signedMoney = (value: bigint) => {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
};
const invoiceBusinessDate = (invoiceNumber: string) => invoiceNumber.slice(4, 14).replaceAll('.', '-');
const cairoDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
export const keyedQueues = <T extends { itemType: string; sourceId: number }>(lines: T[]) => {
  const queues = new Map<string, T[]>();
  for (const line of lines) {
    const key = `${line.itemType}:${line.sourceId}`;
    const values = queues.get(key) ?? [];
    values.push(line);
    queues.set(key, values);
  }
  return queues;
};

export const hydrateInvoice = async (executor: Executor, invoiceId: number) => {
  const invoice = (await executor.select().from(invoices)
    .where(eq(invoices.id, invoiceId)).limit(1))[0];
  if (!invoice || invoice.status === 'draft') return null;
  // The seller's code lives on the employee row; historical invoices may predate sellers.
  const sellerEmployee = invoice.sellerEmployeeId === null ? null
    : (await executor.select({ employeeCode: employees.employeeCode }).from(employees)
      .where(eq(employees.id, invoice.sellerEmployeeId)).limit(1))[0] ?? null;
  const lines = await executor.select().from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.lineNumber));
  const queueEntries = await executor.select().from(serviceQueueEntries)
    .where(eq(serviceQueueEntries.invoiceId, invoiceId))
    .orderBy(asc(serviceQueueEntries.invoiceLineId), asc(serviceQueueEntries.queueNumber));
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
      queueNumbers: queueEntries
        .filter((entry) => entry.invoiceLineId === line.id)
        .map((entry) => entry.queueNumber),
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

export const reconstructInput = async (executor: Executor, invoiceId: number) => {
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

export const quoteServices = async (
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

export const quoteProducts = async (
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
    cost: erpProducts.lastPurchaseCost, commissionPercent: erpProducts.commissionPercent, quantity: erpProductStocks.quantity,
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
      productCostBasis: product.cost, commissionPercent: product.commissionPercent, balanceBefore,
    };
  });
};

export const quoteSale = async (
  database: Database,
  branchId: number,
  input: Parameters<SaleRepository['quote']>[1],
) => {
  const serviceLines = input.lines.filter((line): line is Extract<typeof line, { itemType: 'service' }> => line.itemType === 'service');
  const productLines = input.lines.filter((line): line is Extract<typeof line, { itemType: 'product' }> => line.itemType === 'product');
  const services = await quoteServices(database, branchId, serviceLines);
  const products = await quoteProducts(database, branchId, productLines);
  const byKey = keyedQueues([...services, ...products]);
  const lines = input.lines.map((line) => {
    const sourceId = line.itemType === 'service' ? line.serviceId : line.productId;
    const quoted = byKey.get(`${line.itemType}:${sourceId}`)!.shift()!;
    return {
      itemType: quoted.itemType,
      sourceId: quoted.sourceId,
      name: quoted.name,
      quantity: quoted.quantity,
      unitPrice: quoted.unitPrice,
      lineTotal: quoted.lineTotal,
      ...(quoted.itemType === 'product' ? { commissionPercent: quoted.commissionPercent } : {}),
    };
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
};
