import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { accounts } from '../../auth/index.js';
import { erpProducts } from '../catalog/index.js';

export const stockMovementReasons = [
  'opening_stock', 'count_correction', 'wastage', 'damage', 'sale', 'purchase', 'refund', 'void',
] as const;
export const stockMovementSourceTypes = ['adjustment', 'sale', 'purchase', 'refund', 'void'] as const;

export const erpProductStocks = mysqlTable('erp_product_stocks', {
  productId: int('product_id').notNull(),
  branchId: int('branch_id').notNull(),
  quantity: int('quantity').notNull().default(0),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_product_stocks_product_branch_fk',
    columns: [table.productId, table.branchId],
    foreignColumns: [erpProducts.id, erpProducts.branchId],
  }),
  uniqueIndex('erp_product_stocks_product_branch_unique').on(table.productId, table.branchId),
  index('erp_product_stocks_branch_quantity_idx').on(table.branchId, table.quantity),
  check('erp_product_stocks_quantity_nonnegative', sql`${table.quantity} >= 0`),
]);

export const erpStockMovements = mysqlTable('erp_stock_movements', {
  id: int('id').autoincrement().primaryKey(),
  productId: int('product_id').notNull(),
  branchId: int('branch_id').notNull(),
  reason: mysqlEnum('reason', stockMovementReasons).notNull(),
  sourceType: mysqlEnum('source_type', stockMovementSourceTypes).notNull(),
  sourceId: int('source_id'),
  quantityDelta: int('quantity_delta').notNull(),
  balanceAfter: int('balance_after').notNull(),
  actingAccountId: int('acting_account_id').notNull(),
  note: varchar('note', { length: 500 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_stock_movements_product_branch_fk',
    columns: [table.productId, table.branchId],
    foreignColumns: [erpProducts.id, erpProducts.branchId],
  }),
  foreignKey({
    name: 'erp_stock_movements_account_fk',
    columns: [table.actingAccountId],
    foreignColumns: [accounts.id],
  }),
  index('erp_stock_movements_product_created_idx').on(table.productId, table.createdAt),
  index('erp_stock_movements_branch_created_idx').on(table.branchId, table.createdAt),
  index('erp_stock_movements_source_idx').on(table.sourceType, table.sourceId),
  check('erp_stock_movements_delta_nonzero', sql`${table.quantityDelta} <> 0`),
  check('erp_stock_movements_balance_nonnegative', sql`${table.balanceAfter} >= 0`),
  check(
    'erp_stock_movements_source_consistent',
    sql`(${table.sourceType} = 'adjustment' and ${table.sourceId} is null) or (${table.sourceType} <> 'adjustment' and ${table.sourceId} is not null)`,
  ),
  check(
    'erp_stock_movements_reason_source_consistent',
    sql`(${table.reason} in ('opening_stock', 'count_correction', 'wastage', 'damage') and ${table.sourceType} = 'adjustment') or (${table.reason} in ('sale', 'purchase', 'refund', 'void') and ${table.reason} = ${table.sourceType})`,
  ),
  check(
    'erp_stock_movements_direction_consistent',
    sql`${table.reason} = 'count_correction' or (${table.reason} in ('wastage', 'damage', 'sale') and ${table.quantityDelta} < 0) or (${table.reason} in ('opening_stock', 'purchase', 'refund', 'void') and ${table.quantityDelta} > 0)`,
  ),
]);
