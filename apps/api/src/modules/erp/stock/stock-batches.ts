import { allocateBatchQuantities, batchMilli, formatBatchQuantity, type BatchAllocation, type BatchSelection } from '@capella/contracts';
import type { createDatabase } from '@capella/database';
import { erpStockBatches, erpStockBatchBalances } from '@capella/database/schema';
import { and, asc, eq, sql } from 'drizzle-orm';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;
export class StockBatchError extends Error {
  readonly code = 'BATCH_SELECTION_INVALID';
  constructor(message = 'الدفعة غير متاحة أو كمياتها غير متطابقة. راجع اختيار الدفعات.') {
    super(message);
    this.name = 'StockBatchError';
  }
}

export const readStockBatches = async (tx: Executor, productId: number, branchId: number, lock = false) => {
  const query = tx.select({ batchId: erpStockBatches.id, expiryDate: erpStockBatches.expiryDate, isLegacy: erpStockBatches.isLegacy,
    quantity: erpStockBatchBalances.quantity, consumableQuantity: erpStockBatchBalances.consumableQuantity,
  }).from(erpStockBatchBalances).innerJoin(erpStockBatches, eq(erpStockBatches.id, erpStockBatchBalances.batchId))
    .where(and(eq(erpStockBatchBalances.productId, productId), eq(erpStockBatchBalances.branchId, branchId)))
    .orderBy(asc(erpStockBatchBalances.batchId));
  return lock ? query.for('update') : query;
};

export const createStockBatch = async (tx: Transaction, productId: number, branchId: number, expiryDate: string | null, at: Date, isLegacy = false) => {
  const result = await tx.insert(erpStockBatches).values({ originProductId: productId, originBranchId: branchId, expiryDate, isLegacy, createdAt: at, updatedAt: at });
  return Number(result[0].insertId);
};

/** Caller owns the product/aggregate locks; every balance update uses the same transaction. */
export const addBatchQuantities = async (tx: Transaction, productId: number, branchId: number, batches: BatchAllocation[], pool: 'quantity' | 'consumableQuantity', at: Date) => {
  for (const batch of [...batches].sort((a, b) => a.batchId - b.batchId)) {
    const amount = batchMilli(batch.quantity);
    if (amount <= 0n || (pool === 'quantity' && amount % 1000n !== 0n)) throw new StockBatchError();
    const column = pool === 'quantity' ? erpStockBatchBalances.quantity : erpStockBatchBalances.consumableQuantity;
    const value = pool === 'quantity' ? Number(amount / 1000n) : formatBatchQuantity(amount);
    await tx.insert(erpStockBatchBalances).values({ batchId: batch.batchId, productId, branchId,
      quantity: pool === 'quantity' ? Number(amount / 1000n) : 0,
      consumableQuantity: pool === 'consumableQuantity' ? formatBatchQuantity(amount) : '0.000', updatedAt: at,
    }).onDuplicateKeyUpdate({ set: { [pool]: sql`${column} + ${value}`, updatedAt: at } });
  }
};

/** Legacy imports/test fixtures have aggregate stock but no batch rows. Only bootstrap once. */
export const ensureLegacyBatch = async (tx: Transaction, productId: number, branchId: number, quantity: number, consumableQuantity: string, at: Date) => {
  if ((await readStockBatches(tx, productId, branchId, true)).length || (quantity === 0 && batchMilli(consumableQuantity) === 0n)) return;
  const batchId = await createStockBatch(tx, productId, branchId, null, at, true);
  await tx.insert(erpStockBatchBalances).values({ batchId, productId, branchId, quantity, consumableQuantity, updatedAt: at });
};

export const takeBatchQuantities = async (tx: Transaction, productId: number, branchId: number, quantity: string, pool: 'quantity' | 'consumableQuantity', at: Date, selected?: BatchSelection[], legacyOnly = false) => {
  const rows = (await readStockBatches(tx, productId, branchId, true)).filter((row) => !legacyOnly || row.isLegacy);
  let allocated: BatchAllocation[];
  try { allocated = allocateBatchQuantities(rows.map((row) => ({ batchId: row.batchId, expiryDate: row.expiryDate,
    quantity: pool === 'quantity' ? `${row.quantity}.000` : row.consumableQuantity,
  })), quantity, selected); } catch { throw new StockBatchError(); }
  for (const batch of allocated) {
    const amount = batchMilli(batch.quantity);
    if (pool === 'quantity' && amount % 1000n !== 0n) throw new StockBatchError();
    const column = pool === 'quantity' ? erpStockBatchBalances.quantity : erpStockBatchBalances.consumableQuantity;
    await tx.update(erpStockBatchBalances).set({ [pool]: sql`${column} - ${pool === 'quantity' ? Number(amount / 1000n) : batch.quantity}`, updatedAt: at })
      .where(and(eq(erpStockBatchBalances.batchId, batch.batchId), eq(erpStockBatchBalances.productId, productId), eq(erpStockBatchBalances.branchId, branchId)));
  }
  return allocated;
};

export const legacyRestoration = async (tx: Transaction, productId: number, branchId: number, quantity: string, at: Date): Promise<BatchAllocation[]> => {
  const batchId = await createStockBatch(tx, productId, branchId, null, at, true);
  return [{ batchId, expiryDate: null, quantity }];
};
