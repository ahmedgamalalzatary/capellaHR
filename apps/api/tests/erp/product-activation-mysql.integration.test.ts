import { accounts, auditEvents, branches, erpProducts, erpProductStocks } from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { matchKeyFor } from '../../src/modules/erp/catalog/index.js';
import { createDrizzleProductStockRepository } from '../../src/modules/erp/stock/index.js';
import { createDrizzleSupplierPurchaseRepository } from '../../src/modules/erp/suppliers/suppliers-repository.js';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();
const at = new Date('2026-09-03T09:00:00Z');
let adminId = 0;

beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  adminId = Number((await database.insert(accounts).values({
    username: 'activation-admin', passwordHash: 'unused', role: 'admin', createdAt: at, updatedAt: at,
  }))[0].insertId);
}, 180_000);
afterAll(() => closeMysqlIntegrationDatabase(database), 30_000);

let sequence = 0;
const branch = async () => {
  sequence += 1;
  const marker = `activation-${sequence}-${Date.now()}`;
  return Number((await database.insert(branches).values({
    name: marker, nameNormalized: marker, location: 'Cairo', latitude: 30, longitude: 31,
    gpsAccuracyMeters: 5, attendanceRadiusMeters: 100, createdAt: at, updatedAt: at,
  }))[0].insertId);
};

/** A product a sync created: waiting for stock, not sellable, priced at zero. */
const awaitingProduct = async (branchId: number, state: 'awaiting' | 'inactive' = 'awaiting', quantity = 0) => {
  sequence += 1;
  const name = `Awaiting ${state} ${sequence}`;
  const id = Number((await database.insert(erpProducts).values({
    branchId, name, nameNormalized: `awaiting-${state}-${sequence}`, matchKey: matchKeyFor(name),
    // Only an awaiting product may sit at zero: a product someone switched off
    // keeps the price it was sold at before.
    sellingPrice: state === 'awaiting' ? '0.00' : '50.00',
    isActive: false, awaitingFirstStock: state === 'awaiting', createdAt: at, updatedAt: at,
  }))[0].insertId);
  await database.insert(erpProductStocks).values({ productId: id, branchId, quantity, updatedAt: at });
  return id;
};

const purchases = () => createDrizzleSupplierPurchaseRepository(database, createErpAuditCapability(), () => at);
const stock = () => createDrizzleProductStockRepository(database, createErpAuditCapability(), () => at);

const postPurchase = async (branchId: number, productId: number) => {
  const supplier = await purchases().createSupplier(
    { branchId, name: `Supplier ${productId}`, nameNormalized: `supplier-${productId}`, phone: null, notes: null },
    adminId,
  );
  return purchases().postPurchase({
    branchId, supplierId: supplier.id, idempotencyKey: crypto.randomUUID(),
    idempotencyFingerprint: 'a'.repeat(64), purchaseDate: '2026-09-03', total: '30.00',
    correctsPurchaseId: null,
    lines: [{ productId, quantity: 3, unitCost: '10.00', lineTotal: '30.00', expiryDate: '2027-01-01' }],
  }, adminId);
};

describe('awaiting first stock', () => {
  it('refuses to activate a product before any stock has arrived', async () => {
    const branchId = await branch();
    const productId = await awaitingProduct(branchId);

    await expect(stock().activate(productId, branchId, '50.00', adminId))
      .rejects.toMatchObject({ code: 'PRODUCT_ACTIVATION_NO_STOCK' });
    // Still waiting, still not sellable.
    expect((await database.select().from(erpProducts).where(eq(erpProducts.id, productId)).limit(1))[0])
      .toMatchObject({ isActive: false, awaitingFirstStock: true, sellingPrice: '0.00' });
  });

  it('accepts a purchase while awaiting and stays not sellable until activated', async () => {
    const branchId = await branch();
    const productId = await awaitingProduct(branchId);

    await expect(postPurchase(branchId, productId)).resolves.toBeDefined();
    expect((await database.select().from(erpProducts).where(eq(erpProducts.id, productId)).limit(1))[0])
      .toMatchObject({ isActive: false, awaitingFirstStock: true });
    // Stock arrived, but the till still cannot sell it: only is_active gates that.
    expect((await database.select({ quantity: erpProductStocks.quantity }).from(erpProductStocks)
      .where(and(eq(erpProductStocks.productId, productId), eq(erpProductStocks.branchId, branchId))).limit(1))[0]
      ?.quantity).toBe(3);
  });

  it('activates with the typed price, once stock has arrived', async () => {
    const branchId = await branch();
    const productId = await awaitingProduct(branchId, 'awaiting', 0);
    await postPurchase(branchId, productId);

    await expect(stock().activate(productId, branchId, '50.00', adminId)).resolves.toMatchObject({
      isActive: true, awaitingFirstStock: false, sellingPrice: '50.00',
    });
    expect(await database.select().from(auditEvents).where(and(
      eq(auditEvents.module, 'erp-stock'), eq(auditEvents.action, 'activate'),
    ))).toHaveLength(1);
  });

  it('keeps plain inactive products refusing purchases', async () => {
    // "Awaiting first stock" is its own state; a product someone turned off is
    // still refused, exactly as before.
    const branchId = await branch();
    const productId = await awaitingProduct(branchId, 'inactive');

    await expect(postPurchase(branchId, productId)).rejects.toMatchObject({ code: 'PURCHASE_PRODUCT_INACTIVE' });
  });

  it('refuses a row that is both awaiting and active', async () => {
    // "Not sellable" rests on is_active staying false, so the database refuses
    // the combination outright rather than trusting every writer.
    const branchId = await branch();
    await expect(database.insert(erpProducts).values({
      branchId, name: 'Contradiction', nameNormalized: `contradiction-${Date.now()}`,
      matchKey: matchKeyFor('Contradiction'), sellingPrice: '10.00',
      isActive: true, awaitingFirstStock: true, createdAt: at, updatedAt: at,
    })).rejects.toBeDefined();
  });

  it('suggests no price when no transfer has brought the product in', async () => {
    const branchId = await branch();
    const productId = await awaitingProduct(branchId);
    await expect(stock().latestIncomingPrice(productId, branchId)).resolves.toBeNull();
  });
});
