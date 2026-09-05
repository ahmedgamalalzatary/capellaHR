import { type createDatabase } from '@capella/database';
import {
  cashierSessions,
  erpConsumableBalances,
  erpConsumableConfigurations,
  erpConsumableLedgerEntries,
  erpConsumableTransfers,
  erpProducts,
  erpProductStocks,
  erpServices,
  erpStockMovements,
  invoiceLines,
  invoices,
  serviceConsumptionReports,
  serviceConsumptionUsages,
  serviceQueueEntries,
} from '@capella/database/schema';
import { and, asc, count, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import { ConsumablesError, type ConsumablesRepository } from './consumables-service.js';

type Database = ReturnType<typeof createDatabase>;
type Executor = Parameters<Parameters<Database['transaction']>[0]>[0];

const milli = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0').slice(0, 3));
};
const fromMilli = (value: bigint) => {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 1000n}.${(absolute % 1000n).toString().padStart(3, '0')}`;
};
const moneyMicros = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
};
const fromMicros = (value: bigint) => `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, '0')}`;
const costMoney = (quantityMilli: bigint, unitCostMicros: bigint) => {
  const cents = (quantityMilli * unitCostMicros + 5_000_000n) / 10_000_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
};
const fail = (code: ConstructorParameters<typeof ConsumablesError>[0], message: string): never => {
  throw new ConsumablesError(code, message);
};

const valuation = async (tx: Executor, productId: number, branchId: number, balanceMilli: bigint) => {
  if (balanceMilli === 0n) return 0n;
  const entries = await tx.select({
    entryType: erpConsumableLedgerEntries.entryType,
    totalCost: erpConsumableLedgerEntries.totalCost,
  }).from(erpConsumableLedgerEntries).where(and(
    eq(erpConsumableLedgerEntries.productId, productId),
    eq(erpConsumableLedgerEntries.branchId, branchId),
  )).orderBy(asc(erpConsumableLedgerEntries.id));
  const valueCents = entries.reduce((total, entry) => {
    const cents = BigInt(entry.totalCost.replace('.', ''));
    return total + (entry.entryType === 'reserve' || entry.entryType === 'correction_restore' ? cents : -cents);
  }, 0n);
  return valueCents <= 0n ? 0n : (valueCents * 10_000_000n) / balanceMilli;
};

export const createDrizzleConsumablesRepository = (
  database: Database,
  audit: ErpAuditCapability,
  now: () => Date = () => new Date(),
): ConsumablesRepository => ({
  configure(productId, branchId, unit, packageSize, accountId) {
    return database.transaction(async (tx) => {
      const product = (await tx.select().from(erpProducts).where(and(
        eq(erpProducts.id, productId), eq(erpProducts.branchId, branchId),
      )).for('update').limit(1))[0];
      if (!product) return fail('CONSUMABLE_PRODUCT_NOT_FOUND', 'المنتج غير موجود');
      const existing = (await tx.select().from(erpConsumableConfigurations).where(and(
        eq(erpConsumableConfigurations.productId, productId),
        eq(erpConsumableConfigurations.branchId, branchId),
      )).for('update').limit(1))[0];
      const balance = existing ? (await tx.select().from(erpConsumableBalances).where(and(
        eq(erpConsumableBalances.productId, productId), eq(erpConsumableBalances.branchId, branchId),
      )).for('update').limit(1))[0] : undefined;
      if (existing && balance && milli(balance.quantity) !== 0n
        && (existing.unit !== unit || existing.packageSize !== packageSize)) {
        return fail('CONSUMABLE_BALANCE_NOT_ZERO', 'يجب أن يصبح رصيد المستهلك صفراً قبل تغيير الوحدة أو حجم العبوة');
      }
      const at = now();
      if (existing) {
        await tx.update(erpConsumableConfigurations).set({ unit, packageSize, updatedAt: at }).where(and(
          eq(erpConsumableConfigurations.productId, productId), eq(erpConsumableConfigurations.branchId, branchId),
        ));
      } else {
        await tx.insert(erpConsumableConfigurations).values({ productId, branchId, unit, packageSize, createdAt: at, updatedAt: at });
        await tx.insert(erpConsumableBalances).values({ productId, branchId, quantity: '0.000', updatedAt: at });
      }
      const result = { productId, branchId, unit, packageSize, quantity: balance?.quantity ?? '0.000' };
      await audit.record(tx, { module: 'erp-consumables', action: existing ? 'configure_update' : 'configure', entityType: 'consumable_configuration', entityId: productId, beforeState: existing ?? null, afterState: result, relatedIds: { branchId, actingAccountId: accountId }, createdAt: at });
      return result;
    });
  },

  transfer(input) {
    return database.transaction(async (tx) => {
      const at = now();
      const configuration = (await tx.select().from(erpConsumableConfigurations).where(and(
        eq(erpConsumableConfigurations.productId, input.productId), eq(erpConsumableConfigurations.branchId, input.branchId),
      )).for('update').limit(1))[0];
      if (!configuration) return fail('CONSUMABLE_NOT_CONFIGURED', 'يجب إعداد المنتج كمستهلك أولاً');
      const product = (await tx.select().from(erpProducts).where(and(
        eq(erpProducts.id, input.productId), eq(erpProducts.branchId, input.branchId),
      )).for('update').limit(1))[0]!;
      const stock = (await tx.select().from(erpProductStocks).where(and(
        eq(erpProductStocks.productId, input.productId), eq(erpProductStocks.branchId, input.branchId),
      )).for('update').limit(1))[0]!;
      const balance = (await tx.select().from(erpConsumableBalances).where(and(
        eq(erpConsumableBalances.productId, input.productId), eq(erpConsumableBalances.branchId, input.branchId),
      )).for('update').limit(1))[0]!;
      if (input.direction === 'reserve' && stock.quantity < input.packages) {
        return fail('CONSUMABLE_INSUFFICIENT_SELLABLE_STOCK', 'مخزون العبوات القابلة للبيع غير كافٍ');
      }
      const amount = milli(configuration.packageSize) * BigInt(input.packages);
      const current = milli(balance.quantity);
      if (input.direction === 'return' && current < amount) {
        return fail('CONSUMABLE_INSUFFICIENT_BALANCE', 'رصيد المستهلكات غير كافٍ لإرجاع هذه العبوات');
      }
      const next = input.direction === 'reserve' ? current + amount : current - amount;
      const sellableAfter = input.direction === 'reserve' ? stock.quantity - input.packages : stock.quantity + input.packages;
      const unitCost = input.direction === 'reserve'
        ? (moneyMicros(product.lastPurchaseCost) * 1000n) / milli(configuration.packageSize)
        : await valuation(tx, input.productId, input.branchId, current);
      const totalCost = costMoney(amount, unitCost);
      const transferId = Number((await tx.insert(erpConsumableTransfers).values({
        productId: input.productId, branchId: input.branchId, direction: input.direction,
        packages: input.packages, actingAccountId: input.accountId,
        note: input.note ?? null, createdAt: at,
      }))[0].insertId);
      await tx.update(erpConsumableBalances).set({ quantity: fromMilli(next), updatedAt: at }).where(and(
        eq(erpConsumableBalances.productId, input.productId), eq(erpConsumableBalances.branchId, input.branchId),
      ));
      await tx.update(erpProductStocks).set({ quantity: sellableAfter, updatedAt: at }).where(and(
        eq(erpProductStocks.productId, input.productId), eq(erpProductStocks.branchId, input.branchId),
      ));
      const ledgerInsert = await tx.insert(erpConsumableLedgerEntries).values({
        productId: input.productId, branchId: input.branchId,
        entryType: input.direction === 'reserve' ? 'reserve' : 'return',
        quantityDelta: fromMilli(input.direction === 'reserve' ? amount : -amount), balanceAfter: fromMilli(next),
        unitCostSnapshot: fromMicros(unitCost), totalCost, sourceType: 'transfer', sourceId: transferId,
        actingAccountId: input.accountId, note: input.note ?? null, createdAt: at,
      });
      const ledgerId = Number(ledgerInsert[0].insertId);
      await tx.insert(erpStockMovements).values({
        productId: input.productId, branchId: input.branchId,
        reason: input.direction === 'reserve' ? 'consumable_reserve' : 'consumable_return',
        sourceType: 'consumable_transfer', sourceId: ledgerId,
        quantityDelta: input.direction === 'reserve' ? -input.packages : input.packages,
        balanceAfter: sellableAfter, actingAccountId: input.accountId, note: input.note ?? null, createdAt: at,
      });
      const result = { productId: input.productId, sellableQuantity: sellableAfter, consumableQuantity: fromMilli(next), ledgerId };
      await audit.record(tx, { module: 'erp-consumables', action: input.direction, entityType: 'consumable_stock', entityId: input.productId, beforeState: { sellableQuantity: stock.quantity, consumableQuantity: balance.quantity }, afterState: result, relatedIds: { branchId: input.branchId, actingAccountId: input.accountId }, createdAt: at });
      return result;
    });
  },

  async listBalances(branchId, query) {
    const filters = [eq(erpConsumableConfigurations.branchId, branchId)];
    if (query.search) filters.push(like(erpProducts.name, `%${query.search}%`));
    const where = and(...filters);
    const items = await database.select({
      productId: erpProducts.id, productName: erpProducts.name, unit: erpConsumableConfigurations.unit,
      packageSize: erpConsumableConfigurations.packageSize, consumableQuantity: erpConsumableBalances.quantity,
      sellableQuantity: erpProductStocks.quantity, lastPurchaseCost: erpProducts.lastPurchaseCost,
    }).from(erpConsumableConfigurations)
      .innerJoin(erpProducts, eq(erpProducts.id, erpConsumableConfigurations.productId))
      .innerJoin(erpConsumableBalances, and(eq(erpConsumableBalances.productId, erpConsumableConfigurations.productId), eq(erpConsumableBalances.branchId, branchId)))
      .innerJoin(erpProductStocks, and(eq(erpProductStocks.productId, erpConsumableConfigurations.productId), eq(erpProductStocks.branchId, branchId)))
      .where(where).orderBy(asc(erpProducts.name)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() }).from(erpConsumableConfigurations)
      .innerJoin(erpProducts, eq(erpProducts.id, erpConsumableConfigurations.productId)).where(where);
    return { items, total: totals[0]?.value ?? 0 };
  },

  async listServices(branchId, query, openedByAccountId) {
    const currentEmployeeId = sql<number | null>`coalesce((select reassignment.to_employee_id from erp_invoice_line_reassignments reassignment where reassignment.invoice_line_id = ${invoiceLines.id} order by reassignment.created_at desc, reassignment.id desc limit 1), ${invoiceLines.employeeId})`;
    const currentEmployeeName = sql<string | null>`coalesce((select employee.full_name from erp_invoice_line_reassignments reassignment inner join employees employee on employee.id = reassignment.to_employee_id where reassignment.invoice_line_id = ${invoiceLines.id} order by reassignment.created_at desc, reassignment.id desc limit 1), ${invoiceLines.employeeNameSnapshot})`;
    const filters = [eq(serviceQueueEntries.branchId, branchId)];
    if (query.status === 'unfinished') filters.push(inArray(serviceQueueEntries.status, ['pending', 'overdue']));
    else if (query.status) filters.push(eq(serviceQueueEntries.status, query.status));
    if (query.cashierSessionId) filters.push(eq(serviceQueueEntries.cashierSessionId, query.cashierSessionId));
    if (query.serviceId) filters.push(eq(serviceQueueEntries.serviceId, query.serviceId));
    if (query.employeeId) filters.push(eq(currentEmployeeId, query.employeeId));
    if (openedByAccountId !== undefined) filters.push(eq(cashierSessions.openedByAccountId, openedByAccountId));
    if (query.search) filters.push(or(like(invoices.invoiceNumber, `%${query.search}%`), like(invoices.clientNameSnapshot, `%${query.search}%`))!);
    const where = and(...filters);
    const items = await database.select({
      id: serviceQueueEntries.id, status: serviceQueueEntries.status, queueNumber: serviceQueueEntries.queueNumber,
      cashierSessionId: serviceQueueEntries.cashierSessionId, invoiceId: invoices.id, invoiceNumber: invoices.invoiceNumber,
      clientName: invoices.clientNameSnapshot, clientPhone: invoices.clientPhoneSnapshot,
      serviceId: erpServices.id, serviceName: erpServices.name, employeeId: currentEmployeeId,
      employeeName: currentEmployeeName, createdAt: serviceQueueEntries.createdAt,
      completedAt: serviceQueueEntries.completedAt,
    }).from(serviceQueueEntries)
      .innerJoin(invoices, eq(invoices.id, serviceQueueEntries.invoiceId))
      .innerJoin(invoiceLines, eq(invoiceLines.id, serviceQueueEntries.invoiceLineId))
      .innerJoin(erpServices, eq(erpServices.id, serviceQueueEntries.serviceId))
      .innerJoin(cashierSessions, eq(cashierSessions.id, serviceQueueEntries.cashierSessionId))
      .where(where).orderBy(desc(serviceQueueEntries.createdAt), desc(serviceQueueEntries.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() }).from(serviceQueueEntries)
      .innerJoin(invoices, eq(invoices.id, serviceQueueEntries.invoiceId))
      .innerJoin(invoiceLines, eq(invoiceLines.id, serviceQueueEntries.invoiceLineId))
      .innerJoin(cashierSessions, eq(cashierSessions.id, serviceQueueEntries.cashierSessionId)).where(where);
    return { items, total: totals[0]?.value ?? 0 };
  },

  complete(input) {
    return database.transaction(async (tx) => {
      const at = now();
      const executions = await tx.select().from(serviceQueueEntries).where(and(
        inArray(serviceQueueEntries.id, input.serviceQueueEntryIds), eq(serviceQueueEntries.branchId, input.branchId),
      )).for('update');
      if (executions.length !== input.serviceQueueEntryIds.length) return fail('CONSUMABLE_SERVICE_NOT_FOUND', 'إحدى الخدمات غير موجودة');
      if (new Set(executions.map((entry) => entry.serviceId)).size !== 1) return fail('CONSUMABLE_SERVICES_MUST_MATCH', 'الإدخال الجماعي متاح للخدمات المتطابقة فقط');
      if (executions.some((entry) => entry.status === 'completed')) return fail('CONSUMABLE_SERVICE_ALREADY_COMPLETED', 'إحدى الخدمات مكتملة بالفعل');
      if (executions.some((entry) => entry.status === 'canceled')) return fail('CONSUMABLE_SERVICE_CANCELLED', 'إحدى الخدمات ملغاة');
      if (new Set(input.usages.map((usage) => usage.productId)).size !== input.usages.length) return fail('CONSUMABLE_DUPLICATE_USAGE', 'تم تكرار أحد المستهلكات');
      if (input.accountRole === 'cashier') {
        const sessionIds = [...new Set(executions.map((entry) => entry.cashierSessionId))];
        const open = await tx.select({ id: cashierSessions.id }).from(cashierSessions).where(and(
          inArray(cashierSessions.id, sessionIds), isNull(cashierSessions.closedAt), eq(cashierSessions.openedByAccountId, input.accountId),
        ));
        if (open.length !== sessionIds.length) return fail('CONSUMABLE_SHIFT_CLOSED', 'لا يمكن للكاشير تعديل خدمات وردية مغلقة');
      }
      const demandMultiplier = BigInt(executions.length);
      const balances = new Map<number, { current: bigint; unitCost: bigint; unit: 'ml' | 'gm' }>();
      for (const usage of [...input.usages].sort((left, right) => left.productId - right.productId)) {
        const balance = (await tx.select({ quantity: erpConsumableBalances.quantity, unit: erpConsumableConfigurations.unit }).from(erpConsumableBalances)
          .innerJoin(erpConsumableConfigurations, and(eq(erpConsumableConfigurations.productId, erpConsumableBalances.productId), eq(erpConsumableConfigurations.branchId, erpConsumableBalances.branchId))).where(and(
          eq(erpConsumableBalances.productId, usage.productId), eq(erpConsumableBalances.branchId, input.branchId),
        )).for('update').limit(1))[0];
        if (!balance) return fail('CONSUMABLE_NOT_CONFIGURED', 'أحد المنتجات غير معد كمستهلك');
        const current = milli(balance.quantity);
        const required = milli(usage.quantity) * demandMultiplier;
        if (current < required) return fail('CONSUMABLE_INSUFFICIENT_BALANCE', 'رصيد أحد المستهلكات غير كافٍ');
        balances.set(usage.productId, { current, unitCost: await valuation(tx, usage.productId, input.branchId, current), unit: balance.unit });
      }
      const results: unknown[] = [];
      for (const execution of executions) {
        const reportInsert = await tx.insert(serviceConsumptionReports).values({
          serviceQueueEntryId: execution.id, revision: 1, replacesReportId: null,
          isCurrent: true, completionKind: input.usages.length ? 'consumables' : 'none',
          reason: null, actingAccountId: input.accountId, createdAt: at,
        });
        const reportId = Number(reportInsert[0].insertId);
        for (const usage of input.usages) {
          const state = balances.get(usage.productId)!;
          const amount = milli(usage.quantity);
          const next = state.current - amount;
          const totalCost = costMoney(amount, state.unitCost);
          const ledgerInsert = await tx.insert(erpConsumableLedgerEntries).values({
            productId: usage.productId, branchId: input.branchId, entryType: 'consume',
            quantityDelta: fromMilli(-amount), balanceAfter: fromMilli(next), unitCostSnapshot: fromMicros(state.unitCost),
            totalCost, sourceType: 'service_report', sourceId: reportId, actingAccountId: input.accountId, note: null, createdAt: at,
          });
          const ledgerEntryId = Number(ledgerInsert[0].insertId);
          await tx.insert(serviceConsumptionUsages).values({ reportId, productId: usage.productId, branchId: input.branchId, quantity: usage.quantity, unit: state.unit, unitCostSnapshot: fromMicros(state.unitCost), totalCost, ledgerEntryId });
          await tx.update(erpConsumableBalances).set({ quantity: fromMilli(next), updatedAt: at }).where(and(eq(erpConsumableBalances.productId, usage.productId), eq(erpConsumableBalances.branchId, input.branchId)));
          state.current = next;
        }
        await tx.update(serviceQueueEntries).set({ status: 'completed', completedAt: at, completedByAccountId: input.accountId }).where(eq(serviceQueueEntries.id, execution.id));
        results.push({ serviceQueueEntryId: execution.id, reportId });
      }
      return results;
    });
  },

  correct(input) {
    return database.transaction(async (tx) => {
      const at = now();
      const execution = (await tx.select().from(serviceQueueEntries).where(and(eq(serviceQueueEntries.id, input.serviceQueueEntryId), eq(serviceQueueEntries.branchId, input.branchId))).for('update').limit(1))[0];
      if (!execution) return fail('CONSUMABLE_SERVICE_NOT_FOUND', 'الخدمة غير موجودة');
      if (execution.status !== 'completed') return fail('CONSUMABLE_SERVICE_NOT_COMPLETED', 'يجب إكمال الخدمة قبل تصحيحها');
      if (new Set(input.usages.map((usage) => usage.productId)).size !== input.usages.length) return fail('CONSUMABLE_DUPLICATE_USAGE', 'تم تكرار أحد المستهلكات');
      const session = (await tx.select().from(cashierSessions).where(eq(cashierSessions.id, execution.cashierSessionId)).limit(1))[0]!;
      if (input.accountRole === 'cashier' && (session.closedAt || session.openedByAccountId !== input.accountId)) return fail('CONSUMABLE_SHIFT_CLOSED', 'لا يمكن للكاشير تعديل خدمات وردية مغلقة');
      const previous = (await tx.select().from(serviceConsumptionReports).where(and(eq(serviceConsumptionReports.serviceQueueEntryId, execution.id), eq(serviceConsumptionReports.isCurrent, true))).for('update').limit(1))[0];
      if (!previous) return fail('CONSUMABLE_SERVICE_NOT_FOUND', 'تقرير الخدمة غير موجود');
      const oldUsages = await tx.select().from(serviceConsumptionUsages).where(eq(serviceConsumptionUsages.reportId, previous.id));
      const productIds = [...new Set([...oldUsages.map((usage) => usage.productId), ...input.usages.map((usage) => usage.productId)])].sort((left, right) => left - right);
      const states = new Map<number, { current: bigint; unitCost: bigint; unit: 'ml' | 'gm' }>();
      for (const productId of productIds) {
        const balance = (await tx.select({ quantity: erpConsumableBalances.quantity, unit: erpConsumableConfigurations.unit }).from(erpConsumableBalances)
          .innerJoin(erpConsumableConfigurations, and(eq(erpConsumableConfigurations.productId, erpConsumableBalances.productId), eq(erpConsumableConfigurations.branchId, erpConsumableBalances.branchId)))
          .where(and(eq(erpConsumableBalances.productId, productId), eq(erpConsumableBalances.branchId, input.branchId))).for('update').limit(1))[0];
        if (!balance) return fail('CONSUMABLE_NOT_CONFIGURED', 'أحد المنتجات غير معد كمستهلك');
        if (oldUsages.some((usage) => usage.productId === productId && usage.unit !== balance.unit)) return fail('CONSUMABLE_UNIT_MISMATCH', 'لا يمكن تصحيح استهلاك مسجل بوحدة تختلف عن الوحدة الحالية');
        states.set(productId, { current: milli(balance.quantity), unitCost: await valuation(tx, productId, input.branchId, milli(balance.quantity)), unit: balance.unit });
      }
      await tx.update(serviceConsumptionReports).set({ isCurrent: false }).where(eq(serviceConsumptionReports.id, previous.id));
      const reportInsert = await tx.insert(serviceConsumptionReports).values({ serviceQueueEntryId: execution.id, revision: previous.revision + 1, replacesReportId: previous.id, isCurrent: true, completionKind: input.usages.length ? 'consumables' : 'none', reason: input.reason, actingAccountId: input.accountId, createdAt: at });
      const reportId = Number(reportInsert[0].insertId);
      for (const usage of oldUsages) {
        const state = states.get(usage.productId)!;
        const amount = milli(usage.quantity);
        state.current += amount;
        await tx.insert(erpConsumableLedgerEntries).values({ productId: usage.productId, branchId: input.branchId, entryType: 'correction_restore', quantityDelta: usage.quantity, balanceAfter: fromMilli(state.current), unitCostSnapshot: usage.unitCostSnapshot, totalCost: usage.totalCost, sourceType: 'service_report', sourceId: reportId, actingAccountId: input.accountId, note: input.reason, createdAt: at });
      }
      for (const usage of input.usages) {
        const state = states.get(usage.productId)!;
        if (state.current < milli(usage.quantity)) return fail('CONSUMABLE_INSUFFICIENT_BALANCE', 'رصيد أحد المستهلكات غير كافٍ للتصحيح');
      }
      for (const usage of input.usages) {
        const state = states.get(usage.productId)!;
        const amount = milli(usage.quantity);
        const next = state.current - amount;
        const unitCost = await valuation(tx, usage.productId, input.branchId, state.current);
        const totalCost = costMoney(amount, unitCost);
        const ledgerInsert = await tx.insert(erpConsumableLedgerEntries).values({ productId: usage.productId, branchId: input.branchId, entryType: 'correction_consume', quantityDelta: fromMilli(-amount), balanceAfter: fromMilli(next), unitCostSnapshot: fromMicros(unitCost), totalCost, sourceType: 'service_report', sourceId: reportId, actingAccountId: input.accountId, note: input.reason, createdAt: at });
        await tx.insert(serviceConsumptionUsages).values({ reportId, productId: usage.productId, branchId: input.branchId, quantity: usage.quantity, unit: state.unit, unitCostSnapshot: fromMicros(unitCost), totalCost, ledgerEntryId: Number(ledgerInsert[0].insertId) });
        state.current = next;
      }
      for (const [productId, state] of states) await tx.update(erpConsumableBalances).set({ quantity: fromMilli(state.current), updatedAt: at }).where(and(eq(erpConsumableBalances.productId, productId), eq(erpConsumableBalances.branchId, input.branchId)));
      return { serviceQueueEntryId: execution.id, reportId, revision: previous.revision + 1 };
    });
  },
});
