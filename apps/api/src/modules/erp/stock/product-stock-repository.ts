import { type createDatabase } from '@capella/database';
import { accounts, branches, erpProducts, erpProductStocks, erpStockMovements, erpStockBatches, erpStockBatchBalances, erpStockTransferLines } from '@capella/database/schema';
import { and, asc, count, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type { StockBatch } from '@capella/contracts';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import { ProductStockError, type ProductStockRecord, type ProductStockRepository } from './product-stock-service.js';

import { readStockBatches, createStockBatch, ensureLegacyBatch, takeBatchQuantities, addBatchQuantities, StockBatchError } from './stock-batches.js';
import { withDeadlockRetry } from './deadlock-retry.js';
import type { SyncCopyRunner } from '../product-sync/product-copy-contract.js';

type Database = ReturnType<typeof createDatabase>;
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * A transfer now gives the receiving branch its own batch, so a batch is shared
 * only for rows written before that change. Naming those branches lets the
 * screen say who else is looking at this expiry.
 */
const withSharedBranches = async (
  executor: Executor, batches: StockBatch[], branchId: number,
): Promise<StockBatch[]> => {
  if (!batches.length) return batches;
  const rows = await executor.select({
    batchId: erpStockBatchBalances.batchId,
    branchId: branches.id,
    branchName: branches.name,
  }).from(erpStockBatchBalances)
    .innerJoin(branches, eq(branches.id, erpStockBatchBalances.branchId))
    .where(and(
      inArray(erpStockBatchBalances.batchId, batches.map((batch) => batch.batchId)),
      ne(erpStockBatchBalances.branchId, branchId),
      gt(erpStockBatchBalances.quantity, 0),
    ));
  const shared = new Map<number, Array<{ branchId: number; branchName: string }>>();
  for (const row of rows) {
    shared.set(row.batchId, [...(shared.get(row.batchId) ?? []), { branchId: row.branchId, branchName: row.branchName }]);
  }
  return batches.map((batch) => ({ ...batch, sharedWithBranches: shared.get(batch.batchId) ?? [] }));
};

const productSelection = {
  id: erpProducts.id, branchId: erpProducts.branchId, name: erpProducts.name,
  matchKey: erpProducts.matchKey,
  description: erpProducts.description, sellingPrice: erpProducts.sellingPrice,
  lastPurchaseCost: erpProducts.lastPurchaseCost, lowStockThreshold: erpProducts.lowStockThreshold,
  commissionPercent: erpProducts.commissionPercent,
  barcode: erpProducts.barcode, isActive: erpProducts.isActive,
  awaitingFirstStock: erpProducts.awaitingFirstStock,
  quantity: erpProductStocks.quantity,
  createdAt: erpProducts.createdAt, updatedAt: erpProducts.updatedAt,
};
const scope = (id: number, branchId: number) => and(eq(erpProducts.id, id), eq(erpProducts.branchId, branchId));

export const createDrizzleProductStockRepository = (
  database: Database,
  audit: ErpAuditCapability,
  now: () => Date = () => new Date(),
  /** Present when the product-sync module is enabled for this edition. */
  syncCopy?: SyncCopyRunner,
): ProductStockRepository => ({
  async listBatches(id, branchId) {
    return withSharedBranches(database, await readStockBatches(database, id, branchId), branchId);
  },
  updateBatchExpiry(id, branchId, batchId, expiryDate, accountId) {
    return database.transaction(async (tx) => {
      const before = (await tx.select().from(erpStockBatches).innerJoin(erpStockBatchBalances, eq(erpStockBatchBalances.batchId, erpStockBatches.id))
        .where(and(eq(erpStockBatches.id, batchId), eq(erpStockBatchBalances.productId, id), eq(erpStockBatchBalances.branchId, branchId))).for('update').limit(1))[0];
      if (!before) throw new StockBatchError('الدفعة غير موجودة في هذا الفرع');
      const at = now();
      await tx.update(erpStockBatches).set({ expiryDate, updatedAt: at }).where(eq(erpStockBatches.id, batchId));
      await audit.record(tx, { module: 'erp-stock', action: 'expiry_update', entityType: 'stock-batch', entityId: batchId, beforeState: before.erp_stock_batches, afterState: { expiryDate }, relatedIds: { branchId, productId: id, actingAccountId: accountId }, createdAt: at });
      return withSharedBranches(tx, await readStockBatches(tx, id, branchId), branchId);
    });
  },
  async create(input, actingAccountId) {
    // A deadlock rolls back the whole transaction, so the create is replayed
    // once: the second attempt is the only one left taking these locks.
    return withDeadlockRetry(() => database.transaction(async (tx) => {
      const at = now();
      const { openingQuantity, ...values } = input;
      const inserted = await tx.insert(erpProducts).values({ ...values, createdAt: at, updatedAt: at });
      const id = Number(inserted[0].insertId);
      await tx.insert(erpProductStocks).values({ productId: id, branchId: input.branchId, quantity: openingQuantity, updatedAt: at });
      const record = (await tx.select(productSelection).from(erpProducts).innerJoin(
        erpProductStocks, and(eq(erpProductStocks.productId, erpProducts.id), eq(erpProductStocks.branchId, erpProducts.branchId)),
      ).where(eq(erpProducts.id, id)).limit(1))[0]!;
      await audit.record(tx, { module: 'erp-stock', action: 'create', entityType: 'product', entityId: id, afterState: record, relatedIds: { branchId: input.branchId, actingAccountId }, createdAt: at });
      if (syncCopy) {
        // Same transaction as A's insert; each receiver is a savepoint inside it.
        await syncCopy(tx, {
          branchId: input.branchId,
          productId: id,
          name: input.name,
          description: input.description,
          matchKey: input.matchKey,
        }, actingAccountId);
      }
      return record;
    }));
  },
  async findById(id) {
    const row = (await database.select(productSelection).from(erpProducts).innerJoin(
      erpProductStocks, and(eq(erpProductStocks.productId, erpProducts.id), eq(erpProductStocks.branchId, erpProducts.branchId)),
    ).where(eq(erpProducts.id, id)).limit(1))[0] as ProductStockRecord | undefined;
    return row ? { ...row, batches: await readStockBatches(database, id, row.branchId) } : null;
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
    if (query.awaitingFirstStock !== undefined) {
      filters.push(eq(erpProducts.awaitingFirstStock, query.awaitingFirstStock));
    }
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
  async activate(id, branchId, sellingPrice, actingAccountId) {
    return database.transaction(async (tx) => {
      const product = (await tx.select().from(erpProducts).where(scope(id, branchId)).for('update').limit(1))[0];
      if (!product) throw new ProductStockError('PRODUCT_NOT_FOUND', 'المنتج غير موجود');
      const stockScope = and(eq(erpProductStocks.productId, id), eq(erpProductStocks.branchId, branchId));
      // Stock is checked under the same lock the sale takes, so an activation
      // can never race the last unit out of the door.
      const stock = (await tx.select({ quantity: erpProductStocks.quantity })
        .from(erpProductStocks).where(stockScope).for('update').limit(1))[0];
      if (!stock || stock.quantity <= 0) {
        throw new ProductStockError('PRODUCT_ACTIVATION_NO_STOCK', 'لا يمكن تفعيل المنتج قبل وصول مخزون إليه');
      }
      const at = now();
      await tx.update(erpProducts)
        .set({ sellingPrice, isActive: true, awaitingFirstStock: false, updatedAt: at })
        .where(scope(id, branchId));
      const after = (await tx.select(productSelection).from(erpProducts).innerJoin(
        erpProductStocks, and(eq(erpProductStocks.productId, erpProducts.id), eq(erpProductStocks.branchId, erpProducts.branchId)),
      ).where(scope(id, branchId)).limit(1))[0] as ProductStockRecord;
      await audit.record(tx, {
        module: 'erp-stock', action: 'activate', entityType: 'product', entityId: id,
        beforeState: { isActive: product.isActive, awaitingFirstStock: product.awaitingFirstStock, sellingPrice: product.sellingPrice },
        afterState: { isActive: true, awaitingFirstStock: false, sellingPrice },
        relatedIds: { branchId, actingAccountId }, createdAt: at,
      });
      return after;
    });
  },
  async latestIncomingPrice(id, branchId) {
    const line = (await database.select({ sourceProductId: erpStockTransferLines.sourceProductId })
      .from(erpStockTransferLines)
      .where(and(
        eq(erpStockTransferLines.destinationProductId, id),
        eq(erpStockTransferLines.destinationBranchId, branchId),
      ))
      .orderBy(desc(erpStockTransferLines.id)).limit(1))[0];
    if (!line) return null;
    // The sending branch's *current* price: the Admin is pricing this branch's
    // shelf today, not what the goods cost when they moved.
    const source = (await database.select({ sellingPrice: erpProducts.sellingPrice })
      .from(erpProducts).where(eq(erpProducts.id, line.sourceProductId)).limit(1))[0];
    return source?.sellingPrice ?? null;
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
      await ensureLegacyBatch(tx, id, branchId, stock.quantity, '0.000', at);
      const batches = input.quantityDelta < 0
        ? await takeBatchQuantities(tx, id, branchId, `${-input.quantityDelta}.000`, 'quantity', at, input.batches)
        : input.batches?.map((batch) => ({ ...batch, expiryDate: null }))
          ?? [{ batchId: await createStockBatch(tx, id, branchId, input.expiryDate ?? null, at), expiryDate: input.expiryDate ?? null, quantity: `${input.quantityDelta}.000` }];
      if (input.quantityDelta > 0) {
        if (batches.reduce((sum, batch) => sum + Number(batch.quantity), 0) !== input.quantityDelta) throw new StockBatchError();
        if (input.batches) {
          const owned = await readStockBatches(tx, id, branchId, true);
          if (batches.some((batch) => !owned.some((row) => row.batchId === batch.batchId))) throw new StockBatchError();
          for (const batch of batches) batch.expiryDate = owned.find((row) => row.batchId === batch.batchId)!.expiryDate;
        }
        await addBatchQuantities(tx, id, branchId, batches, 'quantity', at);
      }
      await tx.update(erpProductStocks).set({ quantity: balanceAfter, updatedAt: at }).where(stockScope);
      const inserted = await tx.insert(erpStockMovements).values({
        batches, productId: id, branchId, reason: input.reason, sourceType: 'adjustment', sourceId: null,
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
      batches: erpStockMovements.batches, quantityDelta: erpStockMovements.quantityDelta, balanceAfter: erpStockMovements.balanceAfter,
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
