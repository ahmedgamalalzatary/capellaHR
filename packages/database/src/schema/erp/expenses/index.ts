import { sql } from 'drizzle-orm';
import { check, date, decimal, foreignKey, index, int, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

import { accounts } from '../../auth/index.js';
import { branches } from '../../organization/index.js';
import { erpCategories } from '../catalog/index.js';

export const erpExpenses = mysqlTable('erp_expenses', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull(),
  categoryId: int('category_id').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  expenseDate: date('expense_date', { mode: 'string' }).notNull(),
  description: varchar('description', { length: 1000 }).notNull(),
  actingAccountId: int('acting_account_id').notNull(),
  kind: mysqlEnum('kind', ['expense', 'reversal']).notNull().default('expense'),
  status: mysqlEnum('status', ['active', 'corrected']).notNull().default('active'),
  reversalOfId: int('reversal_of_id'),
  supersedesId: int('supersedes_id'),
  correctionReason: varchar('correction_reason', { length: 500 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_expenses_branch_fk', columns: [table.branchId], foreignColumns: [branches.id] }),
  foreignKey({ name: 'erp_expenses_category_branch_fk', columns: [table.categoryId, table.branchId], foreignColumns: [erpCategories.id, erpCategories.branchId] }),
  foreignKey({ name: 'erp_expenses_account_fk', columns: [table.actingAccountId], foreignColumns: [accounts.id] }),
  foreignKey({ name: 'erp_expenses_reversal_branch_fk', columns: [table.reversalOfId, table.branchId], foreignColumns: [table.id, table.branchId] }),
  foreignKey({ name: 'erp_expenses_supersedes_branch_fk', columns: [table.supersedesId, table.branchId], foreignColumns: [table.id, table.branchId] }),
  uniqueIndex('erp_expenses_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('erp_expenses_reversal_unique').on(table.reversalOfId),
  uniqueIndex('erp_expenses_supersedes_unique').on(table.supersedesId),
  index('erp_expenses_branch_date_idx').on(table.branchId, table.expenseDate, table.id),
  index('erp_expenses_branch_category_date_idx').on(table.branchId, table.categoryId, table.expenseDate),
  check('erp_expenses_amount_positive', sql`${table.amount} > 0`),
  check('erp_expenses_lineage_consistent', sql`(${table.kind} = 'expense' and ${table.reversalOfId} is null) or (${table.kind} = 'reversal' and ${table.reversalOfId} is not null and ${table.supersedesId} is null)`),
  check('erp_expenses_correction_reason_consistent', sql`(${table.reversalOfId} is null and ${table.supersedesId} is null and ${table.correctionReason} is null) or (${table.correctionReason} is not null and (${table.reversalOfId} is not null or ${table.supersedesId} is not null))`),
]);
