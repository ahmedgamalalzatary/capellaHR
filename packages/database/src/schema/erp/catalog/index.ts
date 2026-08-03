import { sql } from 'drizzle-orm';
import {
  boolean,
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

import { employees } from '../../employees/index.js';
import { branches } from '../../organization/index.js';

/** The locked category type set: one table serves services and expenses. */
export const erpCategoryTypes = ['service', 'expense'] as const;

/**
 * One category table with a type flag, as locked in the ERP plan. Categories
 * are branch-scoped like every other ERP business record, so the "name unique
 * per type" rule is enforced within a branch's own catalog.
 *
 * A category is never removed once something references it: `is_active` retires
 * it from new work while `has_ever_been_referenced` permanently blocks deletion,
 * mirroring the Branches protection hook. Historical invoices therefore keep a
 * resolvable category for as long as they exist.
 */
export const erpCategories = mysqlTable('erp_categories', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull().references(() => branches.id),
  type: mysqlEnum('type', erpCategoryTypes).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  nameNormalized: varchar('name_normalized', { length: 64 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  hasEverBeenReferenced: boolean('has_ever_been_referenced').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('erp_categories_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('erp_categories_branch_type_name_unique')
    .on(table.branchId, table.type, table.nameNormalized),
  index('erp_categories_branch_type_active_idx').on(table.branchId, table.type, table.isActive),
]);

/**
 * A service carries one fixed EGP price — no ranges and no cashier-entered
 * pricing — plus the default commission percentage applied to the pre-discount
 * list price. Money and rates are exact `decimal` values, never floats.
 *
 * There is deliberately no delete operation and no soft-delete column: an
 * invoice line snapshots the service's name, price and commission rate at sale
 * time, and the row it points back to must stay resolvable forever. Retiring a
 * service is `is_active = false`, which removes it from the counter without
 * touching any historical fact.
 */
export const erpServices = mysqlTable('erp_services', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull().references(() => branches.id),
  categoryId: int('category_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  nameNormalized: varchar('name_normalized', { length: 64 }).notNull(),
  description: varchar('description', { length: 1000 }),
  price: decimal('price', { precision: 12, scale: 2 }).notNull(),
  commissionPercent: decimal('commission_percent', { precision: 5, scale: 2 }).notNull().default('0.00'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_services_category_branch_fk',
    columns: [table.categoryId, table.branchId],
    foreignColumns: [erpCategories.id, erpCategories.branchId],
  }),
  uniqueIndex('erp_services_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('erp_services_branch_name_unique').on(table.branchId, table.nameNormalized),
  index('erp_services_branch_category_idx').on(table.branchId, table.categoryId),
  index('erp_services_branch_active_idx').on(table.branchId, table.isActive),
  check('erp_services_price_positive', sql`${table.price} > 0`),
  check('erp_services_commission_range', sql`${table.commissionPercent} between 0 and 100`),
]);

/**
 * Per-employee commission override for one service. The sale resolves this
 * before falling back to the service default. The row is configuration, not
 * history: invoice lines snapshot the rate that applied, so editing or removing
 * an override never changes a stored invoice.
 */
export const erpServiceCommissionOverrides = mysqlTable('erp_service_commission_overrides', {
  id: int('id').autoincrement().primaryKey(),
  serviceId: int('service_id').notNull().references(() => erpServices.id),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  commissionPercent: decimal('commission_percent', { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('erp_service_commission_overrides_unique').on(table.serviceId, table.employeeId),
  index('erp_service_commission_overrides_employee_idx').on(table.employeeId),
  check(
    'erp_service_commission_overrides_range',
    sql`${table.commissionPercent} between 0 and 100`,
  ),
]);

/**
 * Product identity is introduced with the core invoice schema so a historical
 * product line always has a real source foreign key. ERP 13 adds stock balances,
 * movements, administration APIs and POS workflows around this catalog fact.
 */
export const erpProducts = mysqlTable('erp_products', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  nameNormalized: varchar('name_normalized', { length: 64 }).notNull(),
  description: varchar('description', { length: 1000 }),
  sellingPrice: decimal('selling_price', { precision: 12, scale: 2 }).notNull(),
  lastPurchaseCost: decimal('last_purchase_cost', { precision: 12, scale: 2 }).notNull().default('0.00'),
  lowStockThreshold: int('low_stock_threshold').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_products_branch_fk',
    columns: [table.branchId],
    foreignColumns: [branches.id],
  }),
  uniqueIndex('erp_products_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('erp_products_branch_name_unique').on(table.branchId, table.nameNormalized),
  index('erp_products_branch_active_idx').on(table.branchId, table.isActive),
  check('erp_products_selling_price_positive', sql`${table.sellingPrice} > 0`),
  check('erp_products_purchase_cost_nonnegative', sql`${table.lastPurchaseCost} >= 0`),
  check('erp_products_low_stock_nonnegative', sql`${table.lowStockThreshold} >= 0`),
]);
