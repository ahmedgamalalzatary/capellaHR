import { sql } from 'drizzle-orm';
import { boolean, check, date, decimal, foreignKey, index, int, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

import { accounts } from '../../auth/index.js';
import { branches } from '../../organization/index.js';
import { erpProducts } from '../catalog/index.js';

export const erpSuppliers = mysqlTable('erp_suppliers', {
  id: int('id').autoincrement().primaryKey(), branchId: int('branch_id').notNull().references(() => branches.id),
  name: varchar('name', { length: 255 }).notNull(), nameNormalized: varchar('name_normalized', { length: 64 }).notNull(),
  phone: varchar('phone', { length: 50 }), notes: varchar('notes', { length: 1000 }), isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(), updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('erp_suppliers_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('erp_suppliers_branch_name_unique').on(table.branchId, table.nameNormalized),
  index('erp_suppliers_branch_active_idx').on(table.branchId, table.isActive),
]);

export const erpPurchases = mysqlTable('erp_purchases', {
  id: int('id').autoincrement().primaryKey(), branchId: int('branch_id').notNull().references(() => branches.id),
  supplierId: int('supplier_id').notNull(), supplierNameSnapshot: varchar('supplier_name_snapshot', { length: 255 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 36 }).notNull(), idempotencyFingerprint: varchar('idempotency_fingerprint', { length: 64 }).notNull(),
  status: mysqlEnum('status', ['posting', 'posted', 'cancelled']).notNull().default('posting'),
  purchaseDate: date('purchase_date', { mode: 'string' }).notNull(), total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  actingAccountId: int('acting_account_id').notNull().references(() => accounts.id),
  cancelledAt: timestamp('cancelled_at', { mode: 'date', fsp: 3 }), cancelledByAccountId: int('cancelled_by_account_id').references(() => accounts.id),
  cancellationReason: varchar('cancellation_reason', { length: 500 }), correctsPurchaseId: int('corrects_purchase_id'),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('erp_purchases_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('erp_purchases_idempotency_unique').on(table.idempotencyKey),
  foreignKey({ name: 'erp_purchases_supplier_branch_fk', columns: [table.supplierId, table.branchId], foreignColumns: [erpSuppliers.id, erpSuppliers.branchId] }),
  foreignKey({ name: 'erp_purchases_correction_fk', columns: [table.correctsPurchaseId, table.branchId], foreignColumns: [table.id, table.branchId] }),
  uniqueIndex('erp_purchases_correction_unique').on(table.correctsPurchaseId),
  index('erp_purchases_branch_date_idx').on(table.branchId, table.purchaseDate), index('erp_purchases_supplier_date_idx').on(table.supplierId, table.purchaseDate),
  check('erp_purchases_total_positive', sql`${table.total} > 0`),
  check('erp_purchases_cancellation_consistent', sql`(${table.status} in ('posting', 'posted') and ${table.cancelledAt} is null and ${table.cancelledByAccountId} is null and ${table.cancellationReason} is null) or (${table.status} = 'cancelled' and ${table.cancelledAt} is not null and ${table.cancelledByAccountId} is not null and ${table.cancellationReason} is not null)`),
]);

export const erpPurchaseLines = mysqlTable('erp_purchase_lines', {
  id: int('id').autoincrement().primaryKey(), purchaseId: int('purchase_id').notNull(), branchId: int('branch_id').notNull(),
  productId: int('product_id').notNull(), productNameSnapshot: varchar('product_name_snapshot', { length: 255 }).notNull(),
  quantity: int('quantity').notNull(), unitCost: decimal('unit_cost', { precision: 12, scale: 2 }).notNull(),
  previousUnitCost: decimal('previous_unit_cost', { precision: 12, scale: 2 }).notNull(),
  lineTotal: decimal('line_total', { precision: 12, scale: 2 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_purchase_lines_purchase_branch_fk', columns: [table.purchaseId, table.branchId], foreignColumns: [erpPurchases.id, erpPurchases.branchId] }),
  foreignKey({ name: 'erp_purchase_lines_product_branch_fk', columns: [table.productId, table.branchId], foreignColumns: [erpProducts.id, erpProducts.branchId] }),
  uniqueIndex('erp_purchase_lines_purchase_product_unique').on(table.purchaseId, table.productId),
  index('erp_purchase_lines_product_idx').on(table.productId, table.purchaseId),
  check('erp_purchase_lines_quantity_positive', sql`${table.quantity} > 0`), check('erp_purchase_lines_unit_cost_positive', sql`${table.unitCost} > 0`),
  check('erp_purchase_lines_previous_cost_nonnegative', sql`${table.previousUnitCost} >= 0`),
  check('erp_purchase_lines_total_positive', sql`${table.lineTotal} > 0`), check('erp_purchase_lines_total_exact', sql`${table.lineTotal} = ${table.unitCost} * ${table.quantity}`),
]);
