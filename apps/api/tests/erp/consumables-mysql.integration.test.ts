import { createDatabase } from '@capella/database';
import {
  accounts, branches, cashierSessions, clients, commissionLedgerEntries, employees, erpCategories,
  erpConsumableBalances, erpConsumableLedgerEntries, erpProducts, erpProductStocks,
  erpServices, erpStockMovements, invoiceLines, invoicePayments, invoices, serviceConsumptionReports,
  serviceQueueEntries,
} from '@capella/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleConsumablesRepository } from '../../src/modules/erp/consumables/index.js';

const controlDatabase = createDatabase(process.env.DATABASE_URL ?? '');
const isolatedDatabaseName = `capella_hr_test_consumables_${process.pid}_${Date.now()}`;
const isolatedDatabaseUrl = new URL(process.env.DATABASE_URL ?? '');
isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`;
const database = createDatabase(isolatedDatabaseUrl.toString());
const at = new Date('2026-09-01T12:00:00.000Z');
let accountId = 0;

beforeAll(async () => {
  if (!/^capella_hr_test_consumables_\d+_\d+$/u.test(isolatedDatabaseName)) throw new Error('Unsafe consumables integration database name');
  await controlDatabase.execute(sql.raw(`CREATE DATABASE \`${isolatedDatabaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));
  await migrate(database, { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/database/migrations') });
  accountId = Number((await database.insert(accounts).values({ username: 'consumables-admin', passwordHash: 'unused', role: 'admin', createdAt: at, updatedAt: at }))[0].insertId);
}, 180_000);

afterAll(async () => {
  await database.$client.promise().end();
  await controlDatabase.execute(sql.raw(`DROP DATABASE IF EXISTS \`${isolatedDatabaseName}\``));
  await controlDatabase.$client.promise().end();
}, 30_000);

const fixture = async () => {
  const marker = `consumables-${Date.now()}`;
  const branchId = Number((await database.insert(branches).values({ name: marker, nameNormalized: marker, location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 100, createdAt: at, updatedAt: at }))[0].insertId);
  const productId = Number((await database.insert(erpProducts).values({ branchId, name: 'Shampoo 150ml', nameNormalized: marker, sellingPrice: '80.00', lastPurchaseCost: '120.00', lowStockThreshold: 0, createdAt: at, updatedAt: at }))[0].insertId);
  await database.insert(erpProductStocks).values({ productId, branchId, quantity: 10, updatedAt: at });
  return { branchId, productId };
};

describe('consumables MySQL inventory integration', () => {
  it('reserves and returns only whole packages without duplicating sellable stock', async () => {
    const data = await fixture();
    const repository = createDrizzleConsumablesRepository(database, createErpAuditCapability(), () => at);
    await repository.configure(data.productId, data.branchId, 'ml', '150.000', accountId);
    await expect(repository.transfer({ ...data, direction: 'reserve', packages: 2, accountId })).resolves.toMatchObject({ sellableQuantity: 8, consumableQuantity: '300.000' });
    await expect(repository.transfer({ ...data, direction: 'return', packages: 1, accountId })).resolves.toMatchObject({ sellableQuantity: 9, consumableQuantity: '150.000' });
    expect((await database.select().from(erpProductStocks).where(and(eq(erpProductStocks.productId, data.productId), eq(erpProductStocks.branchId, data.branchId))).limit(1))[0]?.quantity).toBe(9);
    expect((await database.select().from(erpConsumableBalances).where(eq(erpConsumableBalances.productId, data.productId)).limit(1))[0]?.quantity).toBe('150.000');
    expect((await database.select().from(erpConsumableLedgerEntries)).map((row) => row.entryType)).toEqual(['reserve', 'return']);
    expect((await database.select().from(erpStockMovements)).map((row) => row.reason)).toEqual(['consumable_reserve', 'consumable_return']);
  });

  it('blocks transfers that would make either stock balance negative', async () => {
    const data = await fixture();
    const repository = createDrizzleConsumablesRepository(database, createErpAuditCapability(), () => at);
    await repository.configure(data.productId, data.branchId, 'gm', '100.000', accountId);
    await expect(repository.transfer({ ...data, direction: 'reserve', packages: 11, accountId })).rejects.toMatchObject({ code: 'CONSUMABLE_INSUFFICIENT_SELLABLE_STOCK' });
    await expect(repository.transfer({ ...data, direction: 'return', packages: 1, accountId })).rejects.toMatchObject({ code: 'CONSUMABLE_INSUFFICIENT_BALANCE' });
  });

  it('completes each queue ticket separately, supports no-consumables, and corrects by ledger differences', async () => {
    const data = await fixture();
    const repository = createDrizzleConsumablesRepository(database, createErpAuditCapability(), () => at);
    await repository.configure(data.productId, data.branchId, 'ml', '150.000', accountId);
    await repository.transfer({ ...data, direction: 'reserve', packages: 2, accountId });
    const clientId = Number((await database.insert(clients).values({ branchId: data.branchId, fullName: 'Client', createdAt: at, updatedAt: at }))[0].insertId);
    const employeeId = Number((await database.insert(employees).values({ employeeCode: 900001, fullName: 'Employee', personalPhone: '01000000001', whatsappPhone: '01000000001', pinHash: 'unused', age: 25, address: 'Cairo', branchId: data.branchId, shiftDurationMinutes: 480, monthlyBaseSalary: '5000.00', createdAt: at, updatedAt: at }))[0].insertId);
    const categoryId = Number((await database.insert(erpCategories).values({ branchId: data.branchId, type: 'service', name: 'Hair', nameNormalized: `hair-${Date.now()}`, createdAt: at, updatedAt: at }))[0].insertId);
    const serviceId = Number((await database.insert(erpServices).values({ branchId: data.branchId, categoryId, name: 'Haircut', nameNormalized: `haircut-${Date.now()}`, price: '100.00', commissionPercent: '0.00', createdAt: at, updatedAt: at }))[0].insertId);
    const sessionId = Number((await database.insert(cashierSessions).values({ branchId: data.branchId, openedByAccountId: accountId, openedAt: at }))[0].insertId);
    const invoiceId = Number((await database.insert(invoices).values({ branchId: data.branchId, clientId, sellerEmployeeId: employeeId, actingAccountId: accountId, cashierSessionId: sessionId, invoiceNumber: `C-${Date.now()}`, idempotencyKey: crypto.randomUUID(), status: 'draft', kind: 'sale', clientNameSnapshot: 'Client', sellerNameSnapshot: 'Employee', authorizedBySnapshot: 'admin', subtotal: '300.00', total: '300.00', amountPaid: '0.00', settlementStatus: 'open', soldAt: at, createdAt: at }))[0].insertId);
    const lineId = Number((await database.insert(invoiceLines).values({ invoiceId, branchId: data.branchId, lineNumber: 1, itemType: 'service', serviceId, itemNameSnapshot: 'Haircut', employeeId, employeeNameSnapshot: 'Employee', employeeCodeSnapshot: 900001, quantity: 3, unitPrice: '100.00', lineTotal: '300.00', commissionRuleSnapshot: 'service_default', commissionRateSnapshot: '0.00', commissionAmountSnapshot: '0.00' }))[0].insertId);
    await database.insert(invoicePayments).values({ invoiceId, method: 'cash', amount: '300.00', operationReference: crypto.randomUUID(), isInitial: true, cashierSessionId: sessionId, actingAccountId: accountId, paidAt: at, createdAt: at });
    await database.insert(commissionLedgerEntries).values({ invoiceId, invoiceLineId: lineId, employeeId, actingAccountId: accountId, entryType: 'earned', commissionRuleSnapshot: 'service_default', commissionRateSnapshot: '0.00', baseAmount: '300.00', amount: '0.00', createdAt: at });
    await database.update(invoices).set({ status: 'completed', amountPaid: '300.00', settlementStatus: 'settled' }).where(eq(invoices.id, invoiceId));
    const queueIds: number[] = [];
    for (let queueNumber = 1; queueNumber <= 3; queueNumber += 1) queueIds.push(Number((await database.insert(serviceQueueEntries).values({ invoiceId, invoiceLineId: lineId, branchId: data.branchId, cashierSessionId: sessionId, serviceId, queueNumber, createdAt: at }))[0].insertId));

    await repository.complete({ branchId: data.branchId, accountId, accountRole: 'admin', serviceQueueEntryIds: queueIds.slice(0, 2), usages: [{ productId: data.productId, quantity: '15.000' }] });
    await repository.complete({ branchId: data.branchId, accountId, accountRole: 'admin', serviceQueueEntryIds: [queueIds[2]!], usages: [] });
    await repository.correct({ branchId: data.branchId, accountId, accountRole: 'admin', serviceQueueEntryId: queueIds[0]!, reason: 'Actual measurement', usages: [{ productId: data.productId, quantity: '5.000' }] });

    expect((await database.select().from(erpConsumableBalances).where(eq(erpConsumableBalances.productId, data.productId)).limit(1))[0]?.quantity).toBe('280.000');
    expect((await database.select().from(serviceConsumptionReports)).map((report) => [report.revision, report.isCurrent, report.completionKind])).toEqual(expect.arrayContaining([[1, false, 'consumables'], [1, true, 'consumables'], [1, true, 'none'], [2, true, 'consumables']]));
    expect((await database.select().from(serviceQueueEntries)).every((entry) => entry.status === 'completed')).toBe(true);
  });
});
