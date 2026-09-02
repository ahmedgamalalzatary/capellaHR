import { sql } from 'drizzle-orm';
import {
  check,
  decimal,
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

// A branch-to-branch transfer leaves the sending branch as a sale, so only the
// receiving side needs a reason of its own.
export const stockMovementReasons = [
  'opening_stock', 'count_correction', 'wastage', 'damage', 'sale', 'purchase', 'purchase_cancellation', 'refund', 'void', 'transfer_in', 'consumable_reserve', 'consumable_return',
] as const;
export const stockMovementSourceTypes = ['adjustment', 'sale', 'purchase', 'purchase_cancellation', 'refund', 'void', 'transfer_in', 'consumable_transfer'] as const;

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
    sql`(${table.reason} in ('opening_stock', 'count_correction', 'wastage', 'damage') and ${table.sourceType} = 'adjustment') or (${table.reason} in ('sale', 'purchase', 'purchase_cancellation', 'refund', 'void', 'transfer_in') and ${table.reason} = ${table.sourceType}) or (${table.reason} in ('consumable_reserve', 'consumable_return') and ${table.sourceType} = 'consumable_transfer')`,
  ),
  check(
    'erp_stock_movements_direction_consistent',
    sql`${table.reason} = 'count_correction' or (${table.reason} in ('wastage', 'damage', 'sale', 'purchase_cancellation', 'consumable_reserve') and ${table.quantityDelta} < 0) or (${table.reason} in ('opening_stock', 'purchase', 'refund', 'void', 'transfer_in', 'consumable_return') and ${table.quantityDelta} > 0)`,
  ),
]);

export const consumableUnits = ['ml', 'gm'] as const;
export const consumableLedgerEntryTypes = [
  'reserve', 'return', 'consume', 'correction_restore', 'correction_consume',
] as const;
export const consumableLedgerSourceTypes = ['transfer', 'service_report'] as const;

export const erpConsumableConfigurations = mysqlTable('erp_consumable_configurations', {
  productId: int('product_id').notNull(),
  branchId: int('branch_id').notNull(),
  unit: mysqlEnum('unit', consumableUnits).notNull(),
  packageSize: decimal('package_size', { precision: 14, scale: 3 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_consumable_configurations_product_branch_fk',
    columns: [table.productId, table.branchId],
    foreignColumns: [erpProducts.id, erpProducts.branchId],
  }),
  uniqueIndex('erp_consumable_configurations_product_branch_unique')
    .on(table.productId, table.branchId),
  check('erp_consumable_configurations_package_size_positive', sql`${table.packageSize} > 0`),
]);

export const erpConsumableBalances = mysqlTable('erp_consumable_balances', {
  productId: int('product_id').notNull(),
  branchId: int('branch_id').notNull(),
  quantity: decimal('quantity', { precision: 16, scale: 3 }).notNull().default('0.000'),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_consumable_balances_configuration_fk',
    columns: [table.productId, table.branchId],
    foreignColumns: [erpConsumableConfigurations.productId, erpConsumableConfigurations.branchId],
  }),
  uniqueIndex('erp_consumable_balances_product_branch_unique').on(table.productId, table.branchId),
  index('erp_consumable_balances_branch_quantity_idx').on(table.branchId, table.quantity),
  check('erp_consumable_balances_quantity_nonnegative', sql`${table.quantity} >= 0`),
]);

export const erpConsumableTransfers = mysqlTable('erp_consumable_transfers', {
  id: int('id').autoincrement().primaryKey(),
  productId: int('product_id').notNull(),
  branchId: int('branch_id').notNull(),
  direction: mysqlEnum('direction', ['reserve', 'return']).notNull(),
  packages: int('packages').notNull(),
  actingAccountId: int('acting_account_id').notNull(),
  note: varchar('note', { length: 500 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_consumable_transfers_configuration_fk',
    columns: [table.productId, table.branchId],
    foreignColumns: [erpConsumableConfigurations.productId, erpConsumableConfigurations.branchId],
  }),
  foreignKey({
    name: 'erp_consumable_transfers_account_fk',
    columns: [table.actingAccountId],
    foreignColumns: [accounts.id],
  }),
  index('erp_consumable_transfers_product_created_idx').on(table.productId, table.createdAt),
  check('erp_consumable_transfers_packages_positive', sql`${table.packages} > 0`),
]);

export const erpConsumableLedgerEntries = mysqlTable('erp_consumable_ledger_entries', {
  id: int('id').autoincrement().primaryKey(),
  productId: int('product_id').notNull(),
  branchId: int('branch_id').notNull(),
  entryType: mysqlEnum('entry_type', consumableLedgerEntryTypes).notNull(),
  quantityDelta: decimal('quantity_delta', { precision: 16, scale: 3 }).notNull(),
  balanceAfter: decimal('balance_after', { precision: 16, scale: 3 }).notNull(),
  unitCostSnapshot: decimal('unit_cost_snapshot', { precision: 16, scale: 6 }).notNull(),
  totalCost: decimal('total_cost', { precision: 16, scale: 2 }).notNull(),
  sourceType: mysqlEnum('source_type', consumableLedgerSourceTypes).notNull(),
  sourceId: int('source_id').notNull(),
  actingAccountId: int('acting_account_id').notNull(),
  note: varchar('note', { length: 500 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_consumable_ledger_product_branch_fk',
    columns: [table.productId, table.branchId],
    foreignColumns: [erpConsumableConfigurations.productId, erpConsumableConfigurations.branchId],
  }),
  foreignKey({
    name: 'erp_consumable_ledger_account_fk',
    columns: [table.actingAccountId],
    foreignColumns: [accounts.id],
  }),
  index('erp_consumable_ledger_product_created_idx').on(table.productId, table.createdAt),
  uniqueIndex('erp_consumable_ledger_id_product_branch_unique').on(table.id, table.productId, table.branchId),
  index('erp_consumable_ledger_branch_created_idx').on(table.branchId, table.createdAt),
  index('erp_consumable_ledger_source_idx').on(table.sourceType, table.sourceId),
  check('erp_consumable_ledger_delta_nonzero', sql`${table.quantityDelta} <> 0`),
  check('erp_consumable_ledger_balance_nonnegative', sql`${table.balanceAfter} >= 0`),
  check('erp_consumable_ledger_cost_consistent', sql`${table.unitCostSnapshot} >= 0 and ${table.totalCost} >= 0`),
  check(
    'erp_consumable_ledger_source_consistent',
    sql`(${table.entryType} in ('reserve', 'return') and ${table.sourceType} = 'transfer') or (${table.entryType} in ('consume', 'correction_restore', 'correction_consume') and ${table.sourceType} = 'service_report')`,
  ),
  check(
    'erp_consumable_ledger_direction_consistent',
    sql`(${table.entryType} in ('reserve', 'correction_restore') and ${table.quantityDelta} > 0) or (${table.entryType} in ('return', 'consume', 'correction_consume') and ${table.quantityDelta} < 0)`,
  ),
]);
