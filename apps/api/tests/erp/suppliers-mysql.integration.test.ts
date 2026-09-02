import { accounts, auditEvents, branches, erpProducts, erpProductStocks, erpPurchaseLines, erpPurchases, erpStockMovements } from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuditModule } from '../../src/modules/audit/index.js';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createErpSuppliersModule } from '../../src/modules/erp/index.js';
import type { CreatePurchaseInput } from '@capella/contracts';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase(); let accountId = 0;

beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  const at = new Date(); accountId = Number((await database.insert(accounts).values({ username: `erp14-${process.pid}`, passwordHash: 'unused', role: 'admin', createdAt: at, updatedAt: at }))[0].insertId);
}, 120_000);
afterAll(async () => { await closeMysqlIntegrationDatabase(database); }, 30_000);

let sequence = 0;
const fixture = async (quantity = 1) => {
  sequence += 1; const at = new Date('2026-08-05T10:00:00Z'); const marker = `erp14-${process.pid}-${sequence}`;
  const branchId = Number((await database.insert(branches).values({ name: marker, nameNormalized: marker, location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50, createdAt: at, updatedAt: at }))[0].insertId);
  const productId = Number((await database.insert(erpProducts).values({ branchId, name: `Product ${marker}`, nameNormalized: marker, sellingPrice: '20.00', lastPurchaseCost: '4.00', lowStockThreshold: 0, createdAt: at, updatedAt: at }))[0].insertId);
  await database.insert(erpProductStocks).values({ productId, branchId, quantity, updatedAt: at });
  const module = createErpSuppliersModule(database, { audit: createAuditModule(database).erp, branches: createBranchesModule(database).erp, employees: { findActiveById: async () => null } });
  const actor = { role: 'admin' as const, accountId }; const supplier = await module.service.createSupplier(actor, { branchId, name: `Supplier ${marker}` });
  return { at, branchId, productId, module, actor, supplier };
};
const post = (data: Awaited<ReturnType<typeof fixture>>, input: Omit<CreatePurchaseInput, 'idempotencyKey'>) => data.module.service.postPurchase(data.actor, { ...input, idempotencyKey: randomUUID() });

describe('ERP suppliers and purchases MySQL transaction', () => {
  it('replays one committed purchase for concurrent retries and rejects key reuse with different facts', async () => {
    const data = await fixture(0); const idempotencyKey = '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630';
    const input = { branchId: data.branchId, idempotencyKey, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 2, unitCost: '5.00' }] };
    const [first, retry] = await Promise.all([data.module.service.postPurchase(data.actor, input), data.module.service.postPurchase(data.actor, input)]);
    expect(retry.id).toBe(first.id);
    expect((await database.select().from(erpProductStocks).where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(2);
    expect(await database.select().from(erpStockMovements).where(and(eq(erpStockMovements.sourceId, first.id), eq(erpStockMovements.reason, 'purchase')))).toHaveLength(1);
    const events = await database.select().from(auditEvents).where(and(eq(auditEvents.module, 'erp-purchases'), eq(auditEvents.action, 'post'), eq(auditEvents.entityId, String(first.id))));
    expect(events).toHaveLength(1);
    expect(events[0]?.afterState).toMatchObject({
      id: first.id,
      supplierName: data.supplier.name,
      status: 'posted',
      lines: [expect.objectContaining({ purchaseId: first.id, previousUnitCost: '4.00', postedBalanceAfter: 2 })],
    });
    await expect(data.module.service.postPurchase(data.actor, { ...input, lines: [{ ...input.lines[0]!, quantity: 1 }] })).rejects.toMatchObject({ code: 'PURCHASE_IDEMPOTENCY_CONFLICT' });
  });

  it('posts exact facts, stock and cost atomically, then reverses stock once while preserving history', async () => {
    const data = await fixture(1); const posted = await post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 2, unitCost: '12.50' }] });
    expect(posted).toMatchObject({ total: '25.00', status: 'posted', lines: [expect.objectContaining({ lineTotal: '25.00', productNameSnapshot: expect.stringContaining('Product') })] });
    expect((await database.select().from(erpProductStocks).where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(3);
    expect((await database.select().from(erpProducts).where(eq(erpProducts.id, data.productId)))[0]?.lastPurchaseCost).toBe('12.50');
    await data.module.service.cancelPurchase(data.actor, posted.id, { branchId: data.branchId, reason: 'خطأ' });
    expect((await database.select().from(erpProductStocks).where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(1);
    await expect(data.module.service.cancelPurchase(data.actor, posted.id, { branchId: data.branchId, reason: 'مرة أخرى' })).rejects.toMatchObject({ code: 'PURCHASE_ALREADY_CANCELLED' });
    expect(await database.select().from(erpStockMovements).where(eq(erpStockMovements.sourceId, posted.id))).toHaveLength(2);
    expect(await database.select().from(auditEvents).where(and(eq(auditEvents.module, 'erp-purchases'), eq(auditEvents.entityId, String(posted.id))))).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'post' }), expect.objectContaining({ action: 'cancel' })]));
  });

  it('rolls back an unsafe cancellation without changing the posted fact or writing a reversal', async () => {
    const data = await fixture(0); const posted = await post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 2, unitCost: '5.00' }] });
    await database.update(erpProductStocks).set({ quantity: 1 }).where(eq(erpProductStocks.productId, data.productId));
    await expect(data.module.service.cancelPurchase(data.actor, posted.id, { branchId: data.branchId, reason: 'unsafe' })).rejects.toMatchObject({ code: 'PURCHASE_CANCELLATION_UNSAFE' });
    expect((await database.select().from(erpPurchases).where(eq(erpPurchases.id, posted.id)))[0]?.status).toBe('posted');
    expect(await database.select().from(erpStockMovements).where(and(eq(erpStockMovements.sourceId, posted.id), eq(erpStockMovements.reason, 'purchase_cancellation')))).toHaveLength(0);
  });

  it('rolls back an earlier line when a later cancellation line is unsafe', async () => {
    const data = await fixture(0); const at = data.at;
    const secondProductId = Number((await database.insert(erpProducts).values({ branchId: data.branchId, name: 'Second product', nameNormalized: `second-${sequence}`, sellingPrice: '10.00', lastPurchaseCost: '3.00', lowStockThreshold: 0, createdAt: at, updatedAt: at }))[0].insertId);
    await database.insert(erpProductStocks).values({ productId: secondProductId, branchId: data.branchId, quantity: 0, updatedAt: at });
    const posted = await post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 1, unitCost: '5.00' }, { productId: secondProductId, quantity: 1, unitCost: '6.00' }] });
    await database.update(erpProductStocks).set({ quantity: 0 }).where(eq(erpProductStocks.productId, secondProductId));
    await expect(data.module.service.cancelPurchase(data.actor, posted.id, { branchId: data.branchId, reason: 'unsafe second line' })).rejects.toMatchObject({ code: 'PURCHASE_CANCELLATION_UNSAFE' });
    expect((await database.select().from(erpProductStocks).where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(1);
    expect((await database.select().from(erpProducts).where(eq(erpProducts.id, data.productId)))[0]?.lastPurchaseCost).toBe('5.00');
    expect((await database.select().from(erpPurchases).where(eq(erpPurchases.id, posted.id)))[0]?.status).toBe('posted');
    expect(await database.select().from(erpStockMovements).where(and(eq(erpStockMovements.sourceId, posted.id), eq(erpStockMovements.reason, 'purchase_cancellation')))).toHaveLength(0);
  });

  it('serializes concurrent cancellation so exactly one reversal commits', async () => {
    const data = await fixture(0); const posted = await post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 2, unitCost: '5.00' }] });
    const outcomes = await Promise.allSettled([data.module.service.cancelPurchase(data.actor, posted.id, { branchId: data.branchId, reason: 'A' }), data.module.service.cancelPurchase(data.actor, posted.id, { branchId: data.branchId, reason: 'B' })]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1); expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await database.select().from(erpStockMovements).where(and(eq(erpStockMovements.sourceId, posted.id), eq(erpStockMovements.reason, 'purchase_cancellation')))).toHaveLength(1);
  });

  it('snapshots supplier names and restores the latest remaining posted cost on cancellation', async () => {
    const data = await fixture(0);
    const first = await post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 1, unitCost: '6.00' }] });
    const second = await post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 1, unitCost: '9.00' }] });
    await data.module.service.updateSupplier(data.actor, data.supplier.id, { branchId: data.branchId, name: 'Renamed supplier' });
    expect((await data.module.service.getPurchase(data.actor, first.id, data.branchId)).supplierName).toBe(data.supplier.name);
    await data.module.service.cancelPurchase(data.actor, first.id, { branchId: data.branchId, reason: 'older' });
    expect((await database.select().from(erpProducts).where(eq(erpProducts.id, data.productId)))[0]?.lastPurchaseCost).toBe('9.00');
    await data.module.service.cancelPurchase(data.actor, second.id, { branchId: data.branchId, reason: 'newest' });
    expect((await database.select().from(erpProducts).where(eq(erpProducts.id, data.productId)))[0]?.lastPurchaseCost).toBe('4.00');
  });

  it('rejects post-hoc fact insertion and created-at mutation at the database', async () => {
    const data = await fixture(0); const posted = await post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 1, unitCost: '5.00' }] });
    await expect(database.insert(erpPurchaseLines).values({ purchaseId: posted.id, branchId: data.branchId, productId: data.productId, productNameSnapshot: 'forged', quantity: 1, unitCost: '5.00', previousUnitCost: '4.00', lineTotal: '5.00' })).rejects.toThrow();
    await expect(database.update(erpPurchases).set({ createdAt: new Date('2026-08-06T00:00:00Z') }).where(eq(erpPurchases.id, posted.id))).rejects.toThrow();
  });

  it('rejects finalizing purchases without exact lines or against a non-cancelled correction target', async () => {
    const data = await fixture(0); const key = randomUUID();
    const emptyId = Number((await database.insert(erpPurchases).values({ branchId: data.branchId, supplierId: data.supplier.id, supplierNameSnapshot: data.supplier.name, idempotencyKey: key, idempotencyFingerprint: 'a'.repeat(64), purchaseDate: '2026-08-05', total: '5.00', actingAccountId: accountId, createdAt: data.at }))[0].insertId);
    await expect(database.update(erpPurchases).set({ status: 'posted' }).where(eq(erpPurchases.id, emptyId))).rejects.toThrow();
    const mismatchId = Number((await database.insert(erpPurchases).values({ branchId: data.branchId, supplierId: data.supplier.id, supplierNameSnapshot: data.supplier.name, idempotencyKey: randomUUID(), idempotencyFingerprint: 'c'.repeat(64), purchaseDate: '2026-08-05', total: '6.00', actingAccountId: accountId, createdAt: data.at }))[0].insertId);
    await database.insert(erpPurchaseLines).values({ purchaseId: mismatchId, branchId: data.branchId, productId: data.productId, productNameSnapshot: 'Product', quantity: 1, unitCost: '5.00', previousUnitCost: '4.00', lineTotal: '5.00' });
    await expect(database.update(erpPurchases).set({ status: 'posted' }).where(eq(erpPurchases.id, mismatchId))).rejects.toThrow();
    const original = await post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 1, unitCost: '5.00' }] });
    await expect(database.insert(erpPurchases).values({ branchId: data.branchId, supplierId: data.supplier.id, supplierNameSnapshot: data.supplier.name, idempotencyKey: randomUUID(), idempotencyFingerprint: 'b'.repeat(64), purchaseDate: '2026-08-05', total: '5.00', actingAccountId: accountId, correctsPurchaseId: original.id, createdAt: data.at })).rejects.toThrow();
  });

  it('rolls back all earlier lines when a later product fails and rejects stock overflow stably', async () => {
    const data = await fixture(2); const at = data.at;
    const inactiveId = Number((await database.insert(erpProducts).values({ branchId: data.branchId, name: 'Inactive', nameNormalized: `inactive-${sequence}`, sellingPrice: '10.00', lastPurchaseCost: '2.00', lowStockThreshold: 0, isActive: false, createdAt: at, updatedAt: at }))[0].insertId);
    await database.insert(erpProductStocks).values({ productId: inactiveId, branchId: data.branchId, quantity: 0, updatedAt: at });
    await expect(post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 1, unitCost: '5.00' }, { productId: inactiveId, quantity: 1, unitCost: '2.00' }] })).rejects.toMatchObject({ code: 'PURCHASE_PRODUCT_INACTIVE' });
    expect((await database.select().from(erpProductStocks).where(eq(erpProductStocks.productId, data.productId)))[0]?.quantity).toBe(2);
    expect((await data.module.service.listPurchases(data.actor, { branchId: data.branchId, page: 1, pageSize: 20 })).total).toBe(0);
    await database.update(erpProductStocks).set({ quantity: 2_147_483_647 }).where(eq(erpProductStocks.productId, data.productId));
    await expect(post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 1, unitCost: '5.00' }] })).rejects.toMatchObject({ code: 'PURCHASE_STOCK_OVERFLOW' });
  });

  it('enforces branch isolation and exposes one eligible correction lineage', async () => {
    const data = await fixture(0); const other = await fixture(0); const posted = await post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', lines: [{ productId: data.productId, quantity: 1, unitCost: '5.00' }] });
    await expect(data.module.service.getPurchase(data.actor, posted.id, other.branchId)).rejects.toMatchObject({ code: 'PURCHASE_NOT_FOUND' });
    await data.module.service.cancelPurchase(data.actor, posted.id, { branchId: data.branchId, reason: 'correct' });
    const differentSupplier = await data.module.service.createSupplier(data.actor, { branchId: data.branchId, name: `Different ${sequence}` });
    await expect(post(data, { branchId: data.branchId, supplierId: differentSupplier.id, purchaseDate: '2026-08-05', correctsPurchaseId: posted.id, lines: [{ productId: data.productId, quantity: 1, unitCost: '6.00' }] })).rejects.toMatchObject({ code: 'PURCHASE_CORRECTION_INVALID' });
    const correction = await post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', correctsPurchaseId: posted.id, lines: [{ productId: data.productId, quantity: 1, unitCost: '6.00' }] });
    expect((await data.module.service.getPurchase(data.actor, posted.id, data.branchId)).correctedByPurchaseId).toBe(correction.id);
    await expect(post(data, { branchId: data.branchId, supplierId: data.supplier.id, purchaseDate: '2026-08-05', correctsPurchaseId: posted.id, lines: [{ productId: data.productId, quantity: 1, unitCost: '7.00' }] })).rejects.toMatchObject({ code: 'PURCHASE_CORRECTION_INVALID' });
  });
});
