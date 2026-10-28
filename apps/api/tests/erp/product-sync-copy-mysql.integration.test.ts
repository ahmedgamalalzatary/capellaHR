import { accounts, branches, erpBranchLinks, erpProductLinks, erpProductStocks, erpProducts, erpProductSyncIssues } from '@capella/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createErpAuditCapability } from '../../src/modules/audit/index.js';
import { matchKeyFor, normalizeCatalogName } from '../../src/modules/erp/catalog/index.js';
import {
  createDrizzleProductSyncRepository,
  createProductSyncService,
} from '../../src/modules/erp/product-sync/index.js';
import { createDrizzleProductStockRepository } from '../../src/modules/erp/stock/index.js';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();
const at = new Date('2026-09-07T09:00:00Z');
let adminId = 0;
const admin = { role: 'admin' as const, get accountId() { return adminId; } };

beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  adminId = Number((await database.insert(accounts).values({
    username: 'copy-admin', passwordHash: 'unused', role: 'admin', createdAt: at, updatedAt: at,
  }))[0].insertId);
}, 180_000);
afterAll(() => closeMysqlIntegrationDatabase(database), 30_000);

let sequence = 0;
const branch = async () => {
  sequence += 1;
  const marker = `copy-${sequence}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return Number((await database.insert(branches).values({
    name: marker, nameNormalized: marker, location: 'Cairo', latitude: 30, longitude: 31,
    gpsAccuracyMeters: 5, attendanceRadiusMeters: 100, createdAt: at, updatedAt: at,
  }))[0].insertId);
};

const syncRepository = () => createDrizzleProductSyncRepository(database, createErpAuditCapability(), () => at);
const stockRepository = () => createDrizzleProductStockRepository(
  database, createErpAuditCapability(), () => at, syncRepository().copyOnCreate,
);
const service = () => createProductSyncService({ repository: syncRepository() });

const createProduct = (branchId: number, name: string, description: string | null = null) => (
  stockRepository().create({
    branchId, name, nameNormalized: normalizeCatalogName(name), matchKey: matchKeyFor(name),
    description, sellingPrice: '50.00', lastPurchaseCost: '10.00', commissionPercent: '0.00',
    lowStockThreshold: 0, barcode: null, isActive: true, awaitingFirstStock: false, openingQuantity: 0,
  }, adminId)
);

const activeLink = async (senderBranchId: number, receiverBranchId: number) => {
  const link = await service().create(admin, { senderBranchId, receiverBranchId });
  await service().activate(admin, link.id);
  return link;
};

const productsIn = (branchId: number) => database.select().from(erpProducts).where(eq(erpProducts.branchId, branchId));

describe('ERP copy-on-create', () => {
  it('copies a product created in the sending branch as an awaiting copy', async () => {
    const a = await branch();
    const b = await branch();
    await activeLink(a, b);

    const product = await createProduct(a, 'زيت الأرغان', 'زيت خفيف');

    const [copy] = await productsIn(b);
    expect(copy).toMatchObject({
      name: 'زيت الأرغان', description: 'زيت خفيف', sellingPrice: '0.00',
      lastPurchaseCost: '0.00', barcode: null, isActive: false, awaitingFirstStock: true,
    });
    expect((await database.select().from(erpProductStocks).where(and(
      eq(erpProductStocks.productId, copy!.id), eq(erpProductStocks.branchId, b),
    )).limit(1))[0]?.quantity).toBe(0);
    expect((await database.select().from(erpProductLinks).where(and(
      eq(erpProductLinks.senderProductId, product.id),
      eq(erpProductLinks.receiverBranchId, b),
    )).limit(1))[0]).toMatchObject({ state: 'linked', receiverProductId: copy!.id });
  });

  it('sends only the clashing product to "needs attention", then keeps syncing', async () => {
    const a = await branch();
    const b = await branch();
    await activeLink(a, b);
    await createProduct(b, 'مرطب');

    const clashing = await createProduct(a, 'مرطب');
    expect(await productsIn(a)).toHaveLength(1);
    // B keeps its own row; nothing was created around it.
    expect(await productsIn(b)).toHaveLength(1);
    const issues = await service().issues(admin);
    expect(issues).toEqual([expect.objectContaining({
      senderProductId: clashing.id, receiverBranchId: b, reason: 'name_clash',
    })]);

    // The next new product still syncs.
    await createProduct(a, 'غسول');
    expect(await productsIn(b)).toHaveLength(2);
  });

  it('keeps A\'s product when the copy fails, then retries into a copy', async () => {
    const a = await branch();
    const b = await branch();
    await activeLink(a, b);

    const name = `فشل-${Date.now()}`;
    await database.execute(sql.raw(`DROP TRIGGER IF EXISTS erp_sync_forced_failure`));
    await database.execute(sql.raw(`
      CREATE TRIGGER erp_sync_forced_failure BEFORE INSERT ON erp_products FOR EACH ROW
      BEGIN
        IF NEW.branch_id = ${b} AND NEW.name = '${name}' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced copy failure';
        END IF;
      END
    `));
    try {
      const product = await createProduct(a, name);
      // A's row exists and committed.
      expect((await database.select().from(erpProducts).where(eq(erpProducts.id, product.id)).limit(1))[0])
        .toMatchObject({ name });
      // Nothing half-written in B: no product, so no stock row either.
      expect(await productsIn(b)).toHaveLength(0);
      expect((await database.select().from(erpProductSyncIssues).where(eq(
        erpProductSyncIssues.senderProductId, product.id,
      )).limit(1))[0]).toMatchObject({ reason: 'copy_failed', settledAt: null });
    } finally {
      await database.execute(sql.raw('DROP TRIGGER IF EXISTS erp_sync_forced_failure'));
    }

    const [issue] = (await service().issues(admin)).filter((row) => row.senderBranchId === a);
    await service().settleIssue(admin, issue!.id, { action: 'retry' });
    expect(await productsIn(b)).toHaveLength(1);
    expect((await database.select().from(erpProductSyncIssues).where(eq(erpProductSyncIssues.id, issue!.id)).limit(1))[0]
      ?.settledAt).not.toBeNull();
  });

  it('never follows A\'s later edits', async () => {
    const a = await branch();
    const b = await branch();
    await activeLink(a, b);
    const product = await createProduct(a, 'سيروم', 'الوصف الأول');
    const before = (await productsIn(b))[0]!;

    await stockRepository().update(product.id, a, {
      name: 'سيروم جديد', nameNormalized: normalizeCatalogName('سيروم جديد'),
      matchKey: matchKeyFor('سيروم جديد'), sellingPrice: '99.00', description: 'تغيير',
      barcode: '1234567890123', isActive: false,
    }, adminId);

    const after = (await database.select().from(erpProducts).where(eq(erpProducts.id, before.id)).limit(1))[0]!;
    expect(after).toMatchObject({
      name: 'سيروم', description: 'الوصف الأول', sellingPrice: '0.00',
      barcode: null, isActive: false, awaitingFirstStock: true,
    });
  });

  it('stops copying after unlink and keeps the product links', async () => {
    const a = await branch();
    const b = await branch();
    const link = await activeLink(a, b);
    await createProduct(a, 'بلسم');

    await service().remove(admin, link.id);
    expect(await database.select().from(erpBranchLinks).where(eq(erpBranchLinks.id, link.id))).toHaveLength(0);
    // The link that already existed stays, so transfers still find the product.
    expect(await database.select().from(erpProductLinks).where(and(
      eq(erpProductLinks.senderBranchId, a),
      eq(erpProductLinks.receiverBranchId, b),
    ))).toHaveLength(1);

    await createProduct(a, 'شامبو');
    expect(await productsIn(b)).toHaveLength(1);
  });

  it('reuses existing product links when the same pair is linked again', async () => {
    const a = await branch();
    const b = await branch();
    const first = await activeLink(a, b);
    const product = await createProduct(a, 'كريم');
    const before = (await productsIn(b))[0]!;

    await service().remove(admin, first.id);
    const second = await activeLink(a, b);

    // Nothing to settle: the old answer still holds.
    const setup = await service().setup(admin, second.id);
    expect(setup.allGreen).toBe(true);
    expect(setup.rows).toEqual([expect.objectContaining({
      senderProductId: product.id, kind: 'linked', receiverProductId: before.id,
    })]);
    // And it is not copied a second time.
    expect(await productsIn(b)).toHaveLength(1);
  });
});
