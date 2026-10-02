import { sql } from 'drizzle-orm';
import { boolean, check, date, decimal, foreignKey, index, int, mysqlTable, timestamp, uniqueIndex } from 'drizzle-orm/mysql-core';
import { erpProducts } from '../catalog/index.js';

export type BatchSnapshot = { batchId: number; expiryDate: string | null; quantity: string };

/** A physical lot keeps its identity and expiry across branches and opened packages. */
export const erpStockBatches = mysqlTable('erp_stock_batches', {
  id: int('id').autoincrement().primaryKey(),
  originProductId: int('origin_product_id').notNull(),
  originBranchId: int('origin_branch_id').notNull(),
  expiryDate: date('expiry_date', { mode: 'string' }),
  isLegacy: boolean('is_legacy').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_stock_batches_origin_fk', columns: [table.originProductId, table.originBranchId], foreignColumns: [erpProducts.id, erpProducts.branchId] }),
  index('erp_stock_batches_expiry_idx').on(table.expiryDate),
]);

export const erpStockBatchBalances = mysqlTable('erp_stock_batch_balances', {
  id: int('id').autoincrement().primaryKey(),
  batchId: int('batch_id').notNull().references(() => erpStockBatches.id),
  productId: int('product_id').notNull(),
  branchId: int('branch_id').notNull(),
  quantity: int('quantity').notNull().default(0),
  consumableQuantity: decimal('consumable_quantity', { precision: 16, scale: 3 }).notNull().default('0.000'),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_stock_batch_balances_product_fk', columns: [table.productId, table.branchId], foreignColumns: [erpProducts.id, erpProducts.branchId] }),
  uniqueIndex('erp_stock_batch_balances_lot_product_unique').on(table.batchId, table.productId, table.branchId),
  index('erp_stock_batch_balances_branch_product_idx').on(table.branchId, table.productId),
  check('erp_stock_batch_balances_nonnegative', sql`${table.quantity} >= 0 and ${table.consumableQuantity} >= 0`),
]);
