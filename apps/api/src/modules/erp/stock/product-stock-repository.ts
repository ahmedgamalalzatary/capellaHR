import { type createDatabase } from '@capella/database';
import { accounts, erpProducts, erpProductStocks, erpStockMovements } from '@capella/database/schema';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import { ProductStockError, type ProductStockRecord, type ProductStockRepository } from './product-stock-service.js';

type Database = ReturnType<typeof createDatabase>;
const productSelection = {
  id: erpProducts.id, branchId: erpProducts.branchId, name: erpProducts.name,
  description: erpProducts.description, sellingPrice: erpProducts.sellingPrice,
  lastPurchaseCost: erpProducts.lastPurchaseCost, lowStockThreshold: erpProducts.lowStockThreshold,
  commissionPercent: erpProducts.commissionPercent,
  barcode: erpProducts.barcode, isActive: erpProducts.isActive, quantity: erpProductStocks.quantity,
  createdAt: erpProducts.createdAt, updatedAt: erpProducts.updatedAt,
};
const scope = (id: number, branchId: number) => and(eq(erpProducts.id, id), eq(erpProducts.branchId, branchId));

export const createDrizzleProductStockRepository = (
  database: Database,
  audit: ErpAuditCapability,
  now: () => Date = () => new Date(),
): ProductStockRepository => ({
  async create(input, actingAccountId) {
    return database.transaction(async (tx) => {
      const at = now();
      const { openingQuantity, ...values } = input;
      const inserted = await tx.insert(erpProducts).values({ ...values, createdAt: at, updatedAt: at });
      const id = Number(inserted[0].insertId);
      await tx.insert(erpProductStocks).values({ productId: id, branchId: input.branchId, quantity: openingQuantity, updatedAt: at });
      const record = (await tx.select(productSelection).from(erpProducts).innerJoin(
        erpProductStocks, and(eq(erpProductStocks.productId, erpProducts.id), eq(erpProductStocks.branchId, erpProducts.branchId)),
      ).where(eq(erpProducts.id, id)).limit(1))[0]!;
      await audit.record(tx, { module: 'erp-stock', action: 'create', entityType: 'product', entityId: id, afterState: record, relatedIds: { branchId: input.branchId, actingAccountId }, createdAt: at });
      return record;
    });
  },
  async findById(id) {
    return (await database.select(productSelection).from(erpProducts).innerJoin(
      erpProductStocks, and(eq(erpProductStocks.productId, erpProducts.id), eq(erpProductStocks.branchId, erpProducts.branchId)),
    ).where(eq(erpProducts.id, id)).limit(1))[0] as ProductStockRecord | undefined ?? null;
  },
  async findByNormalizedName(branchId, nameNormalized) {
    return (await database.select(productSelection).from(erpProducts).innerJoin(
      erpProductStocks, and(eq(erpProductStocks.productId, erpProducts.id), eq(erpProductStocks.branchId, erpProducts.branchId)),
    ).where(and(eq(erpProducts.branchId, branchId), eq(erpProducts.nameNormalized, nameNormalized))).limit(1))[0] as ProductStockRecord | undefined ?? null;
  },
  async findByBarcode(branchId, barcode) {
    return (await database.select(productSelection).from(erpProducts).innerJoin(
      erpProductStocks, and(eq(erpProductStocks.productId, erpProducts.id), eq(erpProductStocks.branchId, erpProducts.branchId)),
    ).where(and(eq(erpProducts.branchId, branchId), eq(erpProducts.barcode, barcode))).limit(1))[0] as ProductStockRecord | undefined ?? null;
  },
  async list(branchId, query) {
    const filters = [eq(erpProducts.branchId, branchId)];
    if (query.isActive !== undefined) filters.push(eq(erpProducts.isActive, query.isActive));
    // A search box that a scanner can also be fired into: the typed name or the
    // exact code both find the product, so the admin never has to switch mode.
    if (query.search) {
      filters.push(sql`(locate(${query.search}, ${erpProducts.name}) > 0 or ${erpProducts.barcode} = ${query.search})`);
    }
    if (query.lowStock) filters.push(sql`${erpProductStocks.quantity} <= ${erpProducts.lowStockThreshold}`);
    const where = and(...filters);
    const from = database.select(productSelection).from(erpProducts).innerJoin(
      erpProductStocks, and(eq(erpProductStocks.productId, erpProducts.id), eq(erpProductStocks.branchId, erpProducts.branchId)),
    );
    const items = await from.where(where).orderBy(asc(erpProducts.name), asc(erpProducts.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize) as ProductStockRecord[];
    const totals = await database.select({ value: count() }).from(erpProducts).innerJoin(
      erpProductStocks, and(eq(erpProductStocks.productId, erpProducts.id), eq(erpProductStocks.branchId, erpProducts.branchId)),
    ).where(where);
    return { items, total: totals[0]?.value ?? 0 };
  },
  async update(id, branchId, changes, actingAccountId) {
    return database.transaction(async (tx) => {
      const before = (await tx.select(productSelection).from(erpProducts).innerJoin(
        erpProductStocks, and(eq(erpProductStocks.productId, erpProducts.id), eq(erpProductStocks.branchId, erpProducts.branchId)),
      ).where(scope(id, branchId)).for('update').limit(1))[0] as ProductStockRecord | undefined;
      if (!before) return null;
      if (!Object.keys(changes).length) return before;
      const at = now();
      await tx.update(erpProducts).set({ ...changes, updatedAt: at }).where(scope(id, branchId));
      const after = { ...before, ...changes, updatedAt: at } as ProductStockRecord;
      await audit.record(tx, { module: 'erp-stock', action: 'update', entityType: 'product', entityId: id, beforeState: before, afterState: after, relatedIds: { branchId, actingAccountId }, createdAt: at });
      return after;
    });
  },
  async adjust(id, branchId, input, actingAccountId) {
    return database.transaction(async (tx) => {
      const at = now();
      const product = (await tx.select().from(erpProducts).where(scope(id, branchId)).for('update').limit(1))[0];
      if (!product) throw new ProductStockError('PRODUCT_NOT_FOUND', 'المنتج غير موجود');
      const stockScope = and(eq(erpProductStocks.productId, id), eq(erpProductStocks.branchId, branchId));
      const stock = (await tx.select().from(erpProductStocks).where(stockScope).for('update').limit(1))[0];
      if (!stock) throw new ProductStockError('PRODUCT_NOT_FOUND', 'رصيد المنتج غير موجود');
      const balanceAfter = stock.quantity + input.quantityDelta;
      if (balanceAfter < 0) throw new ProductStockError('INSUFFICIENT_STOCK', 'الكمية المتاحة غير كافية');
      await tx.update(erpProductStocks).set({ quantity: balanceAfter, updatedAt: at }).where(stockScope);
      const inserted = await tx.insert(erpStockMovements).values({
        productId: id, branchId, reason: input.reason, sourceType: 'adjustment', sourceId: null,
        quantityDelta: input.quantityDelta, balanceAfter, actingAccountId, note: input.note ?? null, createdAt: at,
      });
      const movementId = Number(inserted[0].insertId);
      const after: ProductStockRecord = { ...product, quantity: balanceAfter };
      await audit.record(tx, { module: 'erp-stock', action: 'adjust', entityType: 'product-stock', entityId: id, beforeState: { quantity: stock.quantity }, afterState: { quantity: balanceAfter, reason: input.reason, movementId }, relatedIds: { branchId, actingAccountId }, createdAt: at });
      return { product: after, movementId };
    });
  },
  async listMovements(branchId, query) {
    const filters = [eq(erpStockMovements.branchId, branchId)];
    if (query.productId !== undefined) filters.push(eq(erpStockMovements.productId, query.productId));
    if (query.reason !== undefined) filters.push(eq(erpStockMovements.reason, query.reason));
    const where = and(...filters);
    const items = await database.select({
      id: erpStockMovements.id, productId: erpStockMovements.productId,
      branchId: erpStockMovements.branchId, reason: erpStockMovements.reason,
      sourceType: erpStockMovements.sourceType, sourceId: erpStockMovements.sourceId,
      quantityDelta: erpStockMovements.quantityDelta, balanceAfter: erpStockMovements.balanceAfter,
      actingAccountId: erpStockMovements.actingAccountId, note: erpStockMovements.note,
      createdAt: erpStockMovements.createdAt, productName: erpProducts.name,
      actingUsername: accounts.username,
    }).from(erpStockMovements)
      .innerJoin(erpProducts, eq(erpProducts.id, erpStockMovements.productId))
      .innerJoin(accounts, eq(accounts.id, erpStockMovements.actingAccountId))
      .where(where).orderBy(desc(erpStockMovements.createdAt), desc(erpStockMovements.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() }).from(erpStockMovements).where(where);
    return { items, total: totals[0]?.value ?? 0 };
  },
});
