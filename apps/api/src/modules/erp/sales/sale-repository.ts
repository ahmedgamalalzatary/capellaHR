import { type createDatabase } from '@capella/database';
import {
  accounts,
  cashierSessions,
  clients,
  commissionLedgerEntries,
  erpCategories,
  erpServiceCommissionOverrides,
  erpServices,
  employees,
  invoiceLines,
  invoicePayments,
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
  ne,
} from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import { SaleError, type CompleteSaleOperation, type SaleRepository } from './sale-service.js';
import {
  calculateAdjustment,
  calculateCommission,
  calculateLineTotal,
  calculateSaleTotals,
  MoneyCalculationError,
  sumMoney,
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

const hydrateInvoice = async (executor: Executor, invoiceId: number) => {
  const invoice = (await executor.select().from(invoices)
    .where(eq(invoices.id, invoiceId)).limit(1))[0];
  if (!invoice || invoice.status === 'draft') return null;
  const lines = await executor.select().from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.lineNumber));
  const payments = await executor.select().from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoiceId)).orderBy(asc(invoicePayments.id));

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
    payments: payments.map(({ method, amount }) => ({ method, amount })),
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

  const repository: SaleRepository = {
    async quote(branchId, input) {
      const lines = await quoteServices(database, branchId, input.lines);
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

          if (input.lines.some((line) => line.itemType === 'product')) {
            throw new SaleError('PRODUCT_UNAVAILABLE');
          }
          const serviceInputs = input.lines.map((line) => ({
            serviceId: line.itemType === 'service' ? line.serviceId : 0,
            quantity: line.quantity,
          }));
          const quotedLines = await quoteServices(transaction, input.branchId, serviceInputs);
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
          const calculatedLines = quotedLines.map((line) => {
            const commission = rates.get(line.sourceId)!;
            return {
              ...line,
              commissionRule: commission.rule,
              commissionRate: commission.rate,
              commissionAmount: calculateCommission(line.lineTotal, commission.rate),
            };
          });
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
              itemType: 'service',
              serviceId: line.sourceId,
              itemNameSnapshot: line.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
              commissionRuleSnapshot: line.commissionRule,
              commissionRateSnapshot: line.commissionRate,
              commissionAmountSnapshot: line.commissionAmount,
            });
            const invoiceLineId = Number(insertedLine[0].insertId);
            await transaction.insert(commissionLedgerEntries).values({
              invoiceId,
              invoiceLineId,
              employeeId: input.assignedEmployeeId,
              actingAccountId: operation.actingAccountId,
              entryType: 'earned',
              commissionRuleSnapshot: line.commissionRule,
              commissionRateSnapshot: line.commissionRate,
              baseAmount: line.lineTotal,
              amount: line.commissionAmount,
              createdAt: operation.soldAt,
            });
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
      const where = and(eq(invoices.branchId, branchId), ne(invoices.status, 'draft'));
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
