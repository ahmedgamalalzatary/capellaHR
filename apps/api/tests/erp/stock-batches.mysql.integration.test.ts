import { accounts, branches, erpProducts, erpProductStocks, erpPurchases, erpPurchaseLines } from '@capella/database/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { createDrizzleSupplierPurchaseRepository } from '../../src/modules/erp/suppliers/suppliers-repository.js';
import { createDrizzleProductStockRepository } from '../../src/modules/erp/stock/product-stock-repository.js';
import { createDrizzleErpReportRepository } from '../../src/modules/erp/erp-reports/erp-report-repository.js';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();
const at = new Date('2026-10-02T10:00:00Z');
beforeAll(() => prepareMysqlIntegrationDatabase(database), 180_000);
afterAll(() => closeMysqlIntegrationDatabase(database), 30_000);

describe('stock batch persistence', () => {
  it('stores purchase expiry and exposes remaining stock by batch', async () => {
    const accountId = Number((await database.insert(accounts).values({ username: 'expiry-admin', passwordHash: 'unused', role: 'admin', createdAt: at, updatedAt: at }))[0].insertId);
    const branchId = Number((await database.insert(branches).values({ name: 'Expiry branch', nameNormalized: 'expiry', location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 100, createdAt: at, updatedAt: at }))[0].insertId);
    const productId = Number((await database.insert(erpProducts).values({ branchId, name: 'Cream', nameNormalized: 'cream', sellingPrice: '20.00', lastPurchaseCost: '10.00', createdAt: at, updatedAt: at }))[0].insertId);
    await database.insert(erpProductStocks).values({ productId, branchId, quantity: 0, updatedAt: at });
    const purchases = createDrizzleSupplierPurchaseRepository(database, createErpAuditCapability(), () => at);
    const supplier = await purchases.createSupplier({ branchId, name: 'Supplier', nameNormalized: 'supplier', phone: null, notes: null }, accountId);
    const input = { branchId, supplierId: supplier.id, idempotencyKey: crypto.randomUUID(), idempotencyFingerprint: 'a'.repeat(64), purchaseDate: '2026-10-02', total: '30.00', correctsPurchaseId: null,
      lines: [{ productId, quantity: 3, unitCost: '10.00', lineTotal: '30.00', expiryDate: '2027-01-01' }],
    };
    const purchase = await purchases.postPurchase(input, accountId);
    expect(purchase.lines[0]).toMatchObject({ expiryDate: '2027-01-01', batchId: expect.any(Number) });
    const products = createDrizzleProductStockRepository(database, createErpAuditCapability(), () => at);
    expect(await products.findById(productId)).toMatchObject({ quantity: 3, batches: [{ expiryDate: '2027-01-01', quantity: 3, consumableQuantity: '0.000' }] });
    await expect(createDrizzleErpReportRepository(database).readPage('erp-expiry-data', { branchId }, { mode: 'all' }, { page: 1, pageSize: 20 }))
      .resolves.toMatchObject({ total: 1, rows: [{ productName: 'Cream', expiryDate: '2027-01-01', availableQuantity: 3, stockHistory: expect.stringContaining('شراء') }] });
    // A historical purchase has no batch links. Its stock has already gone;
    // cancelling it must not consume the unrelated new purchase above.
    const historicalId = Number((await database.insert(erpPurchases).values({ branchId, supplierId: supplier.id,
      supplierNameSnapshot: 'Supplier', idempotencyKey: crypto.randomUUID(), idempotencyFingerprint: 'b'.repeat(64),
      purchaseDate: '2020-01-01', total: '20.00', actingAccountId: accountId, createdAt: at,
    }))[0].insertId);
    await database.insert(erpPurchaseLines).values({ purchaseId: historicalId, branchId, productId, productNameSnapshot: 'Cream',
      quantity: 2, unitCost: '10.00', previousUnitCost: '10.00', lineTotal: '20.00' });
    await database.update(erpPurchases).set({ status: 'posted' }).where(eq(erpPurchases.id, historicalId));
    await expect(purchases.cancelPurchase(historicalId, branchId, 'Old purchase', accountId)).rejects.toMatchObject({ code: 'PURCHASE_CANCELLATION_UNSAFE' });
  });
});
