import { sql } from 'drizzle-orm';
import {
  check,
  date,
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
import { branches } from '../../organization/index.js';
import { erpProducts } from '../catalog/index.js';
import { invoices } from '../sales/index.js';

/**
 * Moving products between branches is a sale: the sending branch invoices the
 * receiving one at cost. This table is the bridge between that invoice, which
 * carries the sending side, and the stock the receiving side gained.
 *
 * A transfer is never edited or undone — a mistake is corrected by transferring
 * back — so the rows are immutable once posted, guarded by triggers the way
 * purchases are.
 */
export const erpStockTransfers = mysqlTable('erp_stock_transfers', {
  id: int('id').autoincrement().primaryKey(),
  sourceBranchId: int('source_branch_id').notNull().references(() => branches.id),
  destinationBranchId: int('destination_branch_id').notNull().references(() => branches.id),
  invoiceId: int('invoice_id'),
  idempotencyKey: varchar('idempotency_key', { length: 36 }).notNull(),
  status: mysqlEnum('status', ['posting', 'posted']).notNull().default('posting'),
  transferDate: date('transfer_date', { mode: 'string' }).notNull(),
  totalCost: decimal('total_cost', { precision: 14, scale: 2 }).notNull(),
  actingAccountId: int('acting_account_id').notNull().references(() => accounts.id),
  note: varchar('note', { length: 500 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_stock_transfers_invoice_branch_fk',
    columns: [table.invoiceId, table.sourceBranchId],
    foreignColumns: [invoices.id, invoices.branchId],
  }),
  uniqueIndex('erp_stock_transfers_idempotency_unique').on(table.idempotencyKey),
  uniqueIndex('erp_stock_transfers_id_source_unique').on(table.id, table.sourceBranchId),
  uniqueIndex('erp_stock_transfers_id_destination_unique')
    .on(table.id, table.destinationBranchId),
  index('erp_stock_transfers_source_date_idx').on(table.sourceBranchId, table.transferDate),
  index('erp_stock_transfers_destination_date_idx')
    .on(table.destinationBranchId, table.transferDate),
  check('erp_stock_transfers_branches_differ', sql`${table.sourceBranchId} <> ${table.destinationBranchId}`),
  check('erp_stock_transfers_total_nonnegative', sql`${table.totalCost} >= 0`),
  // The invoice is written before the transfer is posted, never after.
  check(
    'erp_stock_transfers_posted_has_invoice',
    sql`${table.status} = 'posting' or ${table.invoiceId} is not null`,
  ),
]);

export const erpStockTransferLines = mysqlTable('erp_stock_transfer_lines', {
  id: int('id').autoincrement().primaryKey(),
  transferId: int('transfer_id').notNull(),
  sourceBranchId: int('source_branch_id').notNull(),
  destinationBranchId: int('destination_branch_id').notNull(),
  sourceProductId: int('source_product_id').notNull(),
  destinationProductId: int('destination_product_id').notNull(),
  productNameSnapshot: varchar('product_name_snapshot', { length: 255 }).notNull(),
  quantity: int('quantity').notNull(),
  unitCost: decimal('unit_cost', { precision: 12, scale: 2 }).notNull(),
  previousDestinationCost: decimal('previous_destination_cost', { precision: 12, scale: 2 }).notNull(),
  lineTotal: decimal('line_total', { precision: 14, scale: 2 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_stock_transfer_lines_transfer_fk',
    columns: [table.transferId, table.sourceBranchId],
    foreignColumns: [erpStockTransfers.id, erpStockTransfers.sourceBranchId],
  }),
  foreignKey({
    name: 'erp_stock_transfer_lines_source_product_fk',
    columns: [table.sourceProductId, table.sourceBranchId],
    foreignColumns: [erpProducts.id, erpProducts.branchId],
  }),
  foreignKey({
    name: 'erp_stock_transfer_lines_destination_product_fk',
    columns: [table.destinationProductId, table.destinationBranchId],
    foreignColumns: [erpProducts.id, erpProducts.branchId],
  }),
  uniqueIndex('erp_stock_transfer_lines_transfer_product_unique')
    .on(table.transferId, table.sourceProductId),
  index('erp_stock_transfer_lines_destination_product_idx')
    .on(table.destinationProductId, table.transferId),
  check('erp_stock_transfer_lines_quantity_positive', sql`${table.quantity} > 0`),
  check('erp_stock_transfer_lines_cost_nonnegative', sql`${table.unitCost} >= 0 and ${table.previousDestinationCost} >= 0`),
  check('erp_stock_transfer_lines_total_exact', sql`${table.lineTotal} = ${table.unitCost} * ${table.quantity}`),
]);
