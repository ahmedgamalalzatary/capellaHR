import { sql } from 'drizzle-orm';
import { check, date, decimal, foreignKey, index, int, mysqlEnum, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

import { accounts } from '../../auth/index.js';
import { branches } from '../../organization/index.js';

export const erpFixedAssetConditions = ['good', 'needs_repair', 'broken'] as const;

/**
 * The branch's fixed-assets register: the chairs, mirrors and air conditioners
 * the branch owns rather than sells. It is deliberately a leaf — no sale, stock
 * movement, report or payroll figure reads it — so a line is edited and deleted
 * in place instead of being corrected by a reversal the way money facts are.
 *
 * Only the name is required. Everything else is the admin's choice to fill in,
 * so quantity, price, purchase date and condition are all nullable and mean
 * "not written down" rather than zero.
 */
export const erpFixedAssets = mysqlTable('erp_fixed_assets', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  quantity: int('quantity'),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }),
  /** Where it stands: "reception", "room 2". Empty means unwritten. */
  location: varchar('location', { length: 255 }).notNull().default(''),
  note: varchar('note', { length: 1000 }).notNull().default(''),
  purchasedOn: date('purchased_on', { mode: 'string' }),
  condition: mysqlEnum('condition', erpFixedAssetConditions),
  actingAccountId: int('acting_account_id').notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_fixed_assets_branch_fk', columns: [table.branchId], foreignColumns: [branches.id] }),
  foreignKey({ name: 'erp_fixed_assets_account_fk', columns: [table.actingAccountId], foreignColumns: [accounts.id] }),
  index('erp_fixed_assets_branch_idx').on(table.branchId, table.id),
  check('erp_fixed_assets_name_present', sql`CHAR_LENGTH(TRIM(${table.name})) > 0`),
  check('erp_fixed_assets_quantity_positive', sql`${table.quantity} is null or ${table.quantity} > 0`),
  check('erp_fixed_assets_unit_price_nonnegative', sql`${table.unitPrice} is null or ${table.unitPrice} >= 0`),
]);
