import { sql } from 'drizzle-orm';
import { check, index, int, mysqlTable, timestamp, uniqueIndex } from 'drizzle-orm/mysql-core';

import { accounts } from '../../auth/index.js';
import { branches } from '../../organization/index.js';

export const cashierSessions = mysqlTable('erp_cashier_sessions', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull().references(() => branches.id),
  openedByAccountId: int('opened_by_account_id').notNull().references(() => accounts.id),
  openedAt: timestamp('opened_at', { mode: 'date', fsp: 3 }).notNull(),
  closedAt: timestamp('closed_at', { mode: 'date', fsp: 3 }),
  closedByAccountId: int('closed_by_account_id').references(() => accounts.id),
  openBranchId: int('open_branch_id')
    .generatedAlwaysAs(sql`case when closed_at is null then branch_id else null end`, { mode: 'stored' }),
}, (table) => [
  uniqueIndex('erp_cashier_sessions_open_branch_unique').on(table.openBranchId),
  index('erp_cashier_sessions_branch_opened_idx').on(table.branchId, table.openedAt),
  index('erp_cashier_sessions_opened_account_idx').on(table.openedByAccountId, table.openedAt),
  index('erp_cashier_sessions_closed_account_idx').on(table.closedByAccountId, table.closedAt),
  check(
    'erp_cashier_sessions_close_state',
    sql`(${table.closedAt} is null and ${table.closedByAccountId} is null) or (${table.closedAt} is not null and ${table.closedByAccountId} is not null and ${table.closedAt} >= ${table.openedAt})`,
  ),
]);
