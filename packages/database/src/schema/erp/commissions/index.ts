import { sql } from 'drizzle-orm';
import {
  check,
  date,
  decimal,
  index,
  int,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { accounts } from '../../auth/index.js';
import { employees } from '../../employees/index.js';
import { branches } from '../../organization/index.js';
import { erpExpenses } from '../expenses/index.js';

/**
 * Cash already handed to an employee from commission they earned this month.
 * Each row is permanent history linked to the drawer expense that paid it.
 */
export const erpCommissionPayouts = mysqlTable('erp_commission_payouts', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  /** Commission month the payout draws from (first day of month). */
  commissionMonth: date('commission_month', { mode: 'string' }).notNull(),
  branchId: int('branch_id').notNull().references(() => branches.id),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  expenseId: int('expense_id').notNull().references(() => erpExpenses.id),
  actingAccountId: int('acting_account_id').notNull().references(() => accounts.id),
  reason: varchar('reason', { length: 200 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('erp_commission_payouts_expense_unique').on(table.expenseId),
  index('erp_commission_payouts_employee_month_idx').on(table.employeeId, table.commissionMonth),
  index('erp_commission_payouts_branch_idx').on(table.branchId),
  check('erp_commission_payouts_amount_positive', sql`${table.amount} > 0`),
  check('erp_commission_payouts_month_first_day', sql`dayofmonth(${table.commissionMonth}) = 1`),
]);
