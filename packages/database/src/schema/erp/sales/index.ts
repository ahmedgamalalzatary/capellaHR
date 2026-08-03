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
import { employees } from '../../employees/index.js';
import { branches } from '../../organization/index.js';
import { erpProducts, erpServices } from '../catalog/index.js';
import { clients } from '../clients/index.js';

export { erpProducts } from '../catalog/index.js';

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
  uniqueIndex('erp_cashier_sessions_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('erp_cashier_sessions_open_branch_unique').on(table.openBranchId),
  index('erp_cashier_sessions_branch_opened_idx').on(table.branchId, table.openedAt),
  index('erp_cashier_sessions_opened_account_idx').on(table.openedByAccountId, table.openedAt),
  index('erp_cashier_sessions_closed_account_idx').on(table.closedByAccountId, table.closedAt),
  check(
    'erp_cashier_sessions_close_state',
    sql`(${table.closedAt} is null and ${table.closedByAccountId} is null) or (${table.closedAt} is not null and ${table.closedByAccountId} is not null and ${table.closedAt} >= ${table.openedAt})`,
  ),
]);

export const invoiceStatuses = ['draft', 'completed', 'partially_refunded', 'refunded', 'voided'] as const;
export const invoiceAdjustmentKinds = ['percentage', 'fixed'] as const;
export const invoiceItemTypes = ['service', 'product'] as const;
export const commissionRules = ['service_default', 'employee_override', 'none'] as const;
export const erpPaymentMethods = ['cash', 'visa', 'instapay', 'vodafone_cash'] as const;

export const invoices = mysqlTable('erp_invoices', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull(),
  clientId: int('client_id').notNull(),
  assignedEmployeeId: int('assigned_employee_id').notNull(),
  actingAccountId: int('acting_account_id').notNull(),
  cashierSessionId: int('cashier_session_id').notNull(),
  invoiceNumber: varchar('invoice_number', { length: 40 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 36 }).notNull(),
  status: mysqlEnum('status', invoiceStatuses).notNull().default('draft'),
  clientNameSnapshot: varchar('client_name_snapshot', { length: 255 }).notNull(),
  clientPhoneSnapshot: varchar('client_phone_snapshot', { length: 11 }).notNull(),
  employeeNameSnapshot: varchar('employee_name_snapshot', { length: 255 }).notNull(),
  employeeCodeSnapshot: int('employee_code_snapshot').notNull(),
  authorizedBySnapshot: varchar('authorized_by_snapshot', { length: 255 }).notNull(),
  subtotal: decimal('subtotal', { precision: 14, scale: 2 }).notNull(),
  discountKind: mysqlEnum('discount_kind', invoiceAdjustmentKinds),
  discountValue: decimal('discount_value', { precision: 14, scale: 2 }),
  discountAmount: decimal('discount_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  taxKind: mysqlEnum('tax_kind', invoiceAdjustmentKinds),
  taxValue: decimal('tax_value', { precision: 14, scale: 2 }),
  taxAmount: decimal('tax_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  total: decimal('total', { precision: 14, scale: 2 }).notNull(),
  soldAt: timestamp('sold_at', { mode: 'date', fsp: 3 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_invoices_branch_fk', columns: [table.branchId], foreignColumns: [branches.id] }),
  foreignKey({ name: 'erp_invoices_client_branch_fk', columns: [table.clientId, table.branchId], foreignColumns: [clients.id, clients.branchId] }),
  foreignKey({ name: 'erp_invoices_employee_branch_fk', columns: [table.assignedEmployeeId, table.branchId], foreignColumns: [employees.id, employees.branchId] }),
  foreignKey({ name: 'erp_invoices_account_fk', columns: [table.actingAccountId], foreignColumns: [accounts.id] }),
  foreignKey({ name: 'erp_invoices_session_branch_fk', columns: [table.cashierSessionId, table.branchId], foreignColumns: [cashierSessions.id, cashierSessions.branchId] }),
  uniqueIndex('erp_invoices_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('erp_invoices_number_unique').on(table.invoiceNumber),
  uniqueIndex('erp_invoices_idempotency_unique').on(table.idempotencyKey),
  index('erp_invoices_branch_sold_idx').on(table.branchId, table.soldAt),
  index('erp_invoices_client_sold_idx').on(table.clientId, table.soldAt),
  index('erp_invoices_employee_sold_idx').on(table.assignedEmployeeId, table.soldAt),
  index('erp_invoices_session_idx').on(table.cashierSessionId),
  check('erp_invoices_subtotal_positive', sql`${table.subtotal} > 0`),
  check(
    'erp_invoices_totals_consistent',
    sql`${table.total} = ${table.subtotal} - ${table.discountAmount} + ${table.taxAmount} and ${table.total} > 0`,
  ),
  check(
    'erp_invoices_discount_consistent',
    sql`(discount_kind is null and discount_value is null and discount_amount = 0) or (discount_kind is not null and discount_value is not null and discount_value >= 0 and discount_amount >= 0 and discount_amount <= subtotal and (discount_kind <> 'percentage' or discount_value <= 100))`,
  ),
  check(
    'erp_invoices_tax_consistent',
    sql`(tax_kind is null and tax_value is null and tax_amount = 0) or (tax_kind is not null and tax_value is not null and tax_value >= 0 and tax_amount >= 0 and (tax_kind <> 'percentage' or tax_value <= 100))`,
  ),
  check('erp_invoices_employee_code_positive', sql`${table.employeeCodeSnapshot} > 0`),
]);

export const invoiceLines = mysqlTable('erp_invoice_lines', {
  id: int('id').autoincrement().primaryKey(),
  invoiceId: int('invoice_id').notNull(),
  branchId: int('branch_id').notNull(),
  lineNumber: int('line_number').notNull(),
  itemType: mysqlEnum('item_type', invoiceItemTypes).notNull(),
  serviceId: int('service_id'),
  productId: int('product_id'),
  itemNameSnapshot: varchar('item_name_snapshot', { length: 255 }).notNull(),
  quantity: int('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  lineTotal: decimal('line_total', { precision: 14, scale: 2 }).notNull(),
  commissionRuleSnapshot: mysqlEnum('commission_rule_snapshot', commissionRules).notNull(),
  commissionRateSnapshot: decimal('commission_rate_snapshot', { precision: 5, scale: 2 }).notNull(),
  commissionAmountSnapshot: decimal('commission_amount_snapshot', { precision: 14, scale: 2 }).notNull(),
  productCostBasisSnapshot: decimal('product_cost_basis_snapshot', { precision: 12, scale: 2 }),
}, (table) => [
  foreignKey({ name: 'erp_invoice_lines_invoice_branch_fk', columns: [table.invoiceId, table.branchId], foreignColumns: [invoices.id, invoices.branchId] }),
  foreignKey({ name: 'erp_invoice_lines_service_branch_fk', columns: [table.serviceId, table.branchId], foreignColumns: [erpServices.id, erpServices.branchId] }),
  foreignKey({ name: 'erp_invoice_lines_product_branch_fk', columns: [table.productId, table.branchId], foreignColumns: [erpProducts.id, erpProducts.branchId] }),
  uniqueIndex('erp_invoice_lines_invoice_line_unique').on(table.invoiceId, table.lineNumber),
  index('erp_invoice_lines_service_idx').on(table.serviceId),
  index('erp_invoice_lines_product_idx').on(table.productId),
  check(
    'erp_invoice_lines_source_consistent',
    sql`(item_type = 'service' and service_id is not null and product_id is null) or (item_type = 'product' and product_id is not null and service_id is null)`,
  ),
  check(
    'erp_invoice_lines_amounts_consistent',
    sql`${table.lineNumber} > 0 and ${table.quantity} > 0 and ${table.unitPrice} > 0 and ${table.lineTotal} = ${table.unitPrice} * ${table.quantity}`,
  ),
  check(
    'erp_invoice_lines_commission_consistent',
    sql`commission_rate_snapshot between 0 and 100 and commission_amount_snapshot >= 0 and ((item_type = 'product' and commission_rule_snapshot = 'none' and commission_rate_snapshot = 0 and commission_amount_snapshot = 0) or (item_type = 'service' and commission_rule_snapshot <> 'none'))`,
  ),
  check(
    'erp_invoice_lines_cost_consistent',
    sql`(item_type = 'service' and product_cost_basis_snapshot is null) or (item_type = 'product' and product_cost_basis_snapshot is not null and product_cost_basis_snapshot >= 0)`,
  ),
]);

export const invoicePayments = mysqlTable('erp_invoice_payments', {
  id: int('id').autoincrement().primaryKey(),
  invoiceId: int('invoice_id').notNull(),
  method: mysqlEnum('method', erpPaymentMethods).notNull(),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_invoice_payments_invoice_fk', columns: [table.invoiceId], foreignColumns: [invoices.id] }),
  uniqueIndex('erp_invoice_payments_invoice_method_unique').on(table.invoiceId, table.method),
  check('erp_invoice_payments_amount_positive', sql`${table.amount} > 0`),
]);

export const invoiceDailySequences = mysqlTable('erp_invoice_daily_sequences', {
  businessDate: date('business_date', { mode: 'string' }).primaryKey(),
  lastValue: int('last_value').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  check('erp_invoice_daily_sequences_value_positive', sql`${table.lastValue} > 0`),
]);

export const commissionLedgerEntries = mysqlTable('erp_commission_ledger_entries', {
  id: int('id').autoincrement().primaryKey(),
  invoiceId: int('invoice_id').notNull(),
  invoiceLineId: int('invoice_line_id').notNull(),
  employeeId: int('employee_id').notNull(),
  actingAccountId: int('acting_account_id').notNull(),
  entryType: mysqlEnum('entry_type', ['earned', 'reversal']).notNull(),
  reversesEntryId: int('reverses_entry_id'),
  commissionRuleSnapshot: mysqlEnum('commission_rule_snapshot', ['service_default', 'employee_override']).notNull(),
  commissionRateSnapshot: decimal('commission_rate_snapshot', { precision: 5, scale: 2 }).notNull(),
  baseAmount: decimal('base_amount', { precision: 14, scale: 2 }).notNull(),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  originalInvoiceLineId: int('original_invoice_line_id')
    .generatedAlwaysAs(sql`case when entry_type = 'earned' then invoice_line_id else null end`, { mode: 'stored' }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_commission_ledger_invoice_fk', columns: [table.invoiceId], foreignColumns: [invoices.id] }),
  foreignKey({ name: 'erp_commission_ledger_line_fk', columns: [table.invoiceLineId], foreignColumns: [invoiceLines.id] }),
  foreignKey({ name: 'erp_commission_ledger_employee_fk', columns: [table.employeeId], foreignColumns: [employees.id] }),
  foreignKey({ name: 'erp_commission_ledger_account_fk', columns: [table.actingAccountId], foreignColumns: [accounts.id] }),
  foreignKey({
    name: 'erp_commission_ledger_reverses_entry_fk',
    columns: [table.reversesEntryId],
    foreignColumns: [table.id],
  }),
  uniqueIndex('erp_commission_ledger_original_line_unique').on(table.originalInvoiceLineId),
  index('erp_commission_ledger_employee_created_idx').on(table.employeeId, table.createdAt),
  index('erp_commission_ledger_invoice_idx').on(table.invoiceId),
  index('erp_commission_ledger_reversal_idx').on(table.reversesEntryId),
  check(
    'erp_commission_ledger_entry_consistent',
    sql`(entry_type = 'earned' and reverses_entry_id is null) or (entry_type = 'reversal' and reverses_entry_id is not null)`,
  ),
  check(
    'erp_commission_ledger_amount_direction',
    sql`${table.baseAmount} > 0 and ${table.commissionRateSnapshot} between 0 and 100 and ((entry_type = 'earned' and amount >= 0) or (entry_type = 'reversal' and amount <= 0))`,
  ),
]);
