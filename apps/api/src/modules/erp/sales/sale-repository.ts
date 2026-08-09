import { type createDatabase } from '@capella/database';
import {
  accounts,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  erpCategories,
  erpProducts,
  erpProductStocks,
  erpStockMovements,
  erpServiceCommissionOverrides,
  erpServices,
  employees,
  invoiceLines,
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
  inArray,
  isNull,
  like,
  ne,
  or,
} from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import { SaleError, type CompleteSaleOperation, type ReverseInvoiceOperation, type SaleRepository } from './sale-service.js';
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
  const lines = await executor.select().from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.lineNumber));
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
  const accountIds = [...new Set(reversals.flatMap((reversal) => [
    reversal.actingAccountId,
    ...(reversal.approvingAccountId === null ? [] : [reversal.approvingAccountId]),
  ]))];
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
  const refundedByPayment = new Map<number, bigint>();
  for (const payment of reversalPayments) {
    refundedByPayment.set(
      payment.invoicePaymentId,
      (refundedByPayment.get(payment.invoicePaymentId) ?? 0n) + toCents(payment.amount),
    );
  }

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    branchId: invoice.branchId,
    cashierSessionId: invoice.cashierSessionId,
    client: {
      id: invoice.clientId,
      name: invoice.clientNameSnapshot,
      phone: invoice.clientPhoneSnapshot,
    },
    assignedEmployee: {
      id: invoice.assignedEmployeeId,
      employeeCode: invoice.employeeCodeSnapshot,
      name: invoice.employeeNameSnapshot,
    },
    authorizedBy: {
      accountId: invoice.actingAccountId,
      username: invoice.authorizedBySnapshot,
    },
    lines: lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      itemType: line.itemType,
      sourceId: line.serviceId ?? line.productId!,
      name: line.itemNameSnapshot,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      commissionRule: line.commissionRuleSnapshot,
      commissionRate: line.commissionRateSnapshot,
      commissionAmount: line.commissionAmountSnapshot,
      productCostBasis: line.productCostBasisSnapshot,
      refundedQuantity: refundedByLine.get(line.id) ?? 0,
      refundableQuantity: line.quantity - (refundedByLine.get(line.id) ?? 0),
    })),
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
        .map((payment) => ({ method: payment.methodSnapshot, amount: payment.amount })),
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
    .where(eq(invoicePayments.invoiceId, invoiceId)).orderBy(asc(invoicePayments.id));
  return {
    branchId: invoice.branchId,
    clientId: invoice.clientId,
    assignedEmployeeId: invoice.assignedEmployeeId,
    cashierSessionId: invoice.cashierSessionId,
    idempotencyKey: invoice.idempotencyKey,
    lines: lines.map((line) => line.itemType === 'service'
      ? { itemType: 'service' as const, serviceId: line.serviceId!, quantity: line.quantity }
      : { itemType: 'product' as const, productId: line.productId!, quantity: line.quantity }),
    ...(invoice.discountKind ? {
      discount: { kind: invoice.discountKind, value: invoice.discountValue! },
    } : {}),
    ...(invoice.taxKind ? {
      tax: { kind: invoice.taxKind, value: invoice.taxValue! },
    } : {}),
    payments: payments.map(({ method, amount }) => ({ method, amount })),
  };
};

const quoteServices = async (
  executor: Executor,
  branchId: number,
  lines: Array<{ serviceId: number; quantity: number }>,
) => {
  const ids = [...new Set(lines.map(({ serviceId }) => serviceId))];
  const rows = await executor.select({
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
    ));
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== ids.length) throw new SaleError('SERVICE_UNAVAILABLE');
  try {
    return lines.map((line) => {
      const service = byId.get(line.serviceId)!;
      return {
        itemType: 'service' as const,
        sourceId: service.id,
        name: service.name,
        quantity: line.quantity,
        unitPrice: service.price,
        lineTotal: calculateLineTotal(service.price, line.quantity),
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
    return {
      itemType: 'product' as const, sourceId: product.id, name: product.name,
      quantity: line.quantity, unitPrice: product.price,
      lineTotal: calculateLineTotal(product.price, line.quantity),
      productCostBasis: product.cost, balanceBefore,
    };
  });
};

export const createDrizzleSaleRepository = (
  database: Database,
  audit: ErpAuditCapability,
): SaleRepository => {
  const findByIdempotencyKey: SaleRepository['findByIdempotencyKey'] = async (key, actor) => {
    const predicate = actor.actingAccountRole === 'cashier'
      ? and(
          eq(invoices.idempotencyKey, key),
          eq(invoices.actingAccountId, actor.actingAccountId),
        )
      : eq(invoices.idempotencyKey, key);
    const row = (await database.select({ id: invoices.id }).from(invoices)
      .where(predicate).limit(1))[0];
    if (!row) return null;
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
            payments: payments.map((payment) => ({
              method: payment.methodSnapshot, amount: payment.amount,
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
          const session = (await transaction.select().from(cashierSessions).where(and(
            eq(cashierSessions.id, input.cashierSessionId),
            eq(cashierSessions.branchId, input.branchId),
            isNull(cashierSessions.closedAt),
          )).for('update').limit(1))[0];
          if (!session || (operation.actingAccountRole === 'cashier'
            && session.openedByAccountId !== operation.actingAccountId)) {
            throw new SaleError('CASHIER_SESSION_NOT_OPEN');
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
          if (operation.actingAccountRole === 'cashier') {
            if (account.employeeId !== operation.actingEmployeeId) {
              throw new SaleError('CASHIER_SESSION_NOT_OPEN');
            }
            const actingEmployee = (await transaction.select({ id: employees.id }).from(employees)
              .where(and(
                eq(employees.id, operation.actingEmployeeId!),
                eq(employees.branchId, input.branchId),
                eq(employees.employmentStatus, 'active'),
                isNull(employees.deletedAt),
              )).for('update').limit(1))[0];
            if (!actingEmployee) throw new SaleError('CASHIER_SESSION_NOT_OPEN');
          }
          const employee = await operation.assertEmployee(transaction);

          const serviceInputs = input.lines.filter((line): line is Extract<typeof line, { itemType: 'service' }> => line.itemType === 'service');
          const productInputs = input.lines.filter((line): line is Extract<typeof line, { itemType: 'product' }> => line.itemType === 'product');
          const quotedLines = await quoteServices(transaction, input.branchId, serviceInputs);
          const quotedProducts = await quoteProducts(transaction, input.branchId, productInputs, true);
          const serviceIds = [...new Set(serviceInputs.map(({ serviceId }) => serviceId))];
          const serviceRows = await transaction.select({
            id: erpServices.id,
            commissionPercent: erpServices.commissionPercent,
          }).from(erpServices).where(inArray(erpServices.id, serviceIds));
          const overrides = await transaction.select().from(erpServiceCommissionOverrides)
            .where(and(
              inArray(erpServiceCommissionOverrides.serviceId, serviceIds),
              eq(erpServiceCommissionOverrides.employeeId, input.assignedEmployeeId),
            ));
          const rates = new Map<number, {
            rule: 'service_default' | 'employee_override';
            rate: string;
          }>(serviceRows.map((service) => [service.id, {
            rule: 'service_default' as const,
            rate: service.commissionPercent,
          }]));
          for (const override of overrides) rates.set(override.serviceId, {
            rule: 'employee_override' as const,
            rate: override.commissionPercent,
          });
          const calculatedServices = quotedLines.map((line) => {
            const commission = rates.get(line.sourceId)!;
            return {
              ...line,
              commissionRule: commission.rule,
              commissionRate: commission.rate,
              commissionAmount: calculateCommission(line.lineTotal, commission.rate),
            };
          });
          const calculatedProducts = quotedProducts.map((line) => ({
            ...line, commissionRule: 'none' as const, commissionRate: '0.00', commissionAmount: '0.00',
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
          if (totals.paymentTotal !== totals.total) throw new SaleError('PAYMENT_TOTAL_MISMATCH');

          const inserted = await transaction.insert(invoices).values({
            branchId: input.branchId,
            clientId: input.clientId,
            assignedEmployeeId: input.assignedEmployeeId,
            actingAccountId: operation.actingAccountId,
            cashierSessionId: input.cashierSessionId,
            invoiceNumber: operation.invoiceNumber,
            idempotencyKey: input.idempotencyKey,
            clientNameSnapshot: client.fullName,
            clientPhoneSnapshot: client.phone,
            employeeNameSnapshot: employee.fullName,
            employeeCodeSnapshot: employee.employeeCode,
            authorizedBySnapshot: account.username,
            subtotal: totals.subtotal,
            discountKind: input.discount?.kind ?? null,
            discountValue: input.discount?.value ?? null,
            discountAmount: totals.discountAmount,
            taxKind: input.tax?.kind ?? null,
            taxValue: input.tax?.value ?? null,
            taxAmount: totals.taxAmount,
            total: totals.total,
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
                invoiceId, invoiceLineId, employeeId: input.assignedEmployeeId,
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
          await transaction.insert(invoicePayments).values(input.payments.map((payment) => ({
            invoiceId,
            method: payment.method,
            amount: payment.amount,
            createdAt: operation.soldAt,
          })));
          await transaction.update(invoices).set({ status: 'completed' })
            .where(eq(invoices.id, invoiceId));
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
              employeeId: input.assignedEmployeeId,
              cashierSessionId: input.cashierSessionId,
            },
            createdAt: operation.soldAt,
          });
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

    async reverse(operation: ReverseInvoiceOperation) {
      const existing = await existingReversal(operation);
      if (existing) return existing;
      try {
        return await database.transaction(async (transaction) => {
          const original = (await transaction.select().from(invoices).where(and(
            eq(invoices.id, operation.invoiceId),
            eq(invoices.branchId, operation.input.branchId),
            ne(invoices.status, 'draft'),
          )).for('update').limit(1))[0];
          if (!original) throw new SaleError('INVOICE_NOT_FOUND');
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

          const account = (await transaction.select({
            role: accounts.role, employeeId: accounts.employeeId, active: accounts.active,
          }).from(accounts).where(eq(accounts.id, operation.actingAccountId))
            .for('update').limit(1))[0];
          if (!account || !account.active || account.role !== operation.actingAccountRole) {
            throw new SaleError('INVOICE_NOT_REVERSIBLE');
          }
          if (operation.actingAccountRole === 'cashier') {
            const employee = (await transaction.select({ id: employees.id }).from(employees)
              .where(and(
                eq(employees.id, account.employeeId!),
                eq(employees.branchId, operation.input.branchId),
                eq(employees.employmentStatus, 'active'),
                isNull(employees.deletedAt),
              )).for('update').limit(1))[0];
            if (!employee) throw new SaleError('INVOICE_NOT_REVERSIBLE');
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
            amount: invoiceReversalPayments.amount,
          }).from(invoiceReversalPayments).innerJoin(
            invoiceReversals,
            eq(invoiceReversals.id, invoiceReversalPayments.reversalId),
          ).where(and(
            eq(invoiceReversals.invoiceId, original.id),
            eq(invoiceReversals.status, 'finalized'),
          ));
          const reversedByPayment = new Map<number, bigint>();
          for (const payment of priorPayments) {
            reversedByPayment.set(
              payment.invoicePaymentId,
              (reversedByPayment.get(payment.invoicePaymentId) ?? 0n) + toCents(payment.amount),
            );
          }
          const requestedPayments = operation.type === 'void'
            ? originalPayments.map(({ method, amount }) => ({ method, amount }))
            : operation.input.payments;
          const paymentRows = requestedPayments.map((requested) => {
            const payment = originalPayments.find((candidate) => candidate.method === requested.method);
            if (!payment) throw new SaleError('REFUND_PAYMENT_EXCEEDED');
            const remaining = toCents(payment.amount) - (reversedByPayment.get(payment.id) ?? 0n);
            if (toCents(requested.amount) > remaining) {
              throw new SaleError('REFUND_PAYMENT_EXCEEDED');
            }
            return { invoicePaymentId: payment.id, method: requested.method, amount: requested.amount };
          });
          if (sumMoney(paymentRows.map(({ amount }) => amount)) !== allocation.total) {
            throw new SaleError('REFUND_PAYMENT_MISMATCH');
          }

          const beforeState = await hydrateInvoice(transaction, original.id);
          const inserted = await transaction.insert(invoiceReversals).values({
            invoiceId: original.id,
            branchId: original.branchId,
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
            await transaction.insert(invoiceReversalPayments).values(paymentRows.map((payment) => ({
              reversalId,
              invoicePaymentId: payment.invoicePaymentId,
              methodSnapshot: payment.method,
              amount: payment.amount,
            })));
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
          const finalizedReversalIds = new Set((await transaction.select({ id: invoiceReversals.id })
            .from(invoiceReversals).where(and(
              eq(invoiceReversals.invoiceId, original.id),
              eq(invoiceReversals.status, 'finalized'),
            ))).map(({ id }) => id));
          for (const line of originalLines.filter((candidate) => (
            candidate.itemType === 'service' && selectedByLine.has(candidate.id)
          ))) {
            const earned = ledger.find((entry) => (
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
            await transaction.insert(commissionLedgerEntries).values({
              invoiceId: original.id,
              invoiceLineId: line.id,
              employeeId: original.assignedEmployeeId,
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
        employeeId: invoices.assignedEmployeeId,
        employeeName: invoices.employeeNameSnapshot,
        soldAt: invoices.soldAt,
      }).from(invoices).where(where).orderBy(desc(invoices.soldAt), desc(invoices.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      return {
        items: rows.map((row) => ({
          id: row.id,
          invoiceNumber: row.invoiceNumber,
          status: row.status as Exclude<typeof row.status, 'draft'>,
          total: row.total,
          assignedEmployee: { id: row.employeeId, name: row.employeeName },
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
        clientId: invoices.clientId,
        clientName: invoices.clientNameSnapshot,
        employeeId: invoices.assignedEmployeeId,
        employeeName: invoices.employeeNameSnapshot,
        soldAt: invoices.soldAt,
      }).from(invoices).where(where).orderBy(desc(invoices.soldAt), desc(invoices.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      return {
        items: rows.map((row) => ({
          id: row.id,
          invoiceNumber: row.invoiceNumber,
          status: row.status as Exclude<typeof row.status, 'draft'>,
          total: row.total,
          client: { id: row.clientId, name: row.clientName },
          assignedEmployee: { id: row.employeeId, name: row.employeeName },
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
