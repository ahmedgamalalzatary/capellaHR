import { sql } from 'drizzle-orm';
import {
  check,
  boolean,
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
  /** A shift the system ended at its 16-hour limit; no human closed it. */
  autoClosedAt: timestamp('auto_closed_at', { mode: 'date', fsp: 3 }),
  openBranchId: int('open_branch_id')
    .generatedAlwaysAs(sql`case when closed_at is null then branch_id else null end`, { mode: 'stored' }),
}, (table) => [
  uniqueIndex('erp_cashier_sessions_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('erp_cashier_sessions_open_branch_unique').on(table.openBranchId),
  index('erp_cashier_sessions_branch_opened_idx').on(table.branchId, table.openedAt),
  index('erp_cashier_sessions_opened_account_idx').on(table.openedByAccountId, table.openedAt),
  index('erp_cashier_sessions_closed_account_idx').on(table.closedByAccountId, table.closedAt),
  // An open shift has neither fact; a closed one names a closing account or,
  // when the system ended it at the 16-hour limit, carries auto_closed_at instead.
  // A system close is stamped at the limit itself, never at the sweep that found it.
  check(
    'erp_cashier_sessions_close_state',
    sql`(${table.closedAt} is null and ${table.closedByAccountId} is null and ${table.autoClosedAt} is null) or (${table.closedAt} is not null and ${table.closedAt} >= ${table.openedAt} and ((${table.closedByAccountId} is not null and ${table.autoClosedAt} is null) or (${table.closedByAccountId} is null and ${table.autoClosedAt} is not null and ${table.autoClosedAt} = ${table.closedAt} and ${table.autoClosedAt} = ${table.openedAt} + interval 16 hour)))`,
  ),
]);

export const invoiceStatuses = ['draft', 'completed', 'partially_refunded', 'refunded', 'voided'] as const;
/**
 * A customer sale, or internal trade between two branches. A transfer has no
 * seller and earns no commission, so the seller rule applies to sales only.
 */
export const invoiceKinds = ['sale', 'branch_transfer'] as const;
export const invoiceAdjustmentKinds = ['percentage', 'fixed'] as const;
export const invoiceItemTypes = ['service', 'product'] as const;
export const commissionRules = ['service_default', 'employee_override', 'none'] as const;
export const erpPaymentMethods = ['cash', 'visa', 'instapay', 'vodafone_cash'] as const;
export const invoiceSettlementStatuses = ['settled', 'open'] as const;

export const invoices = mysqlTable('erp_invoices', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull(),
  clientId: int('client_id').notNull(),
  sellerEmployeeId: int('seller_employee_id'),
  actingAccountId: int('acting_account_id').notNull(),
  cashierSessionId: int('cashier_session_id').notNull(),
  invoiceNumber: varchar('invoice_number', { length: 40 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 36 }).notNull(),
  status: mysqlEnum('status', invoiceStatuses).notNull().default('draft'),
  kind: mysqlEnum('kind', invoiceKinds).notNull().default('sale'),
  // Mirrors the client record: whichever of the two identified them at the till.
  clientNameSnapshot: varchar('client_name_snapshot', { length: 255 }),
  clientPhoneSnapshot: varchar('client_phone_snapshot', { length: 11 }),
  sellerNameSnapshot: varchar('seller_name_snapshot', { length: 255 }),
  authorizedBySnapshot: varchar('authorized_by_snapshot', { length: 255 }).notNull(),
  subtotal: decimal('subtotal', { precision: 14, scale: 2 }).notNull(),
  discountKind: mysqlEnum('discount_kind', invoiceAdjustmentKinds),
  discountValue: decimal('discount_value', { precision: 14, scale: 2 }),
  discountAmount: decimal('discount_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  taxKind: mysqlEnum('tax_kind', invoiceAdjustmentKinds),
  taxValue: decimal('tax_value', { precision: 14, scale: 2 }),
  taxAmount: decimal('tax_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  total: decimal('total', { precision: 14, scale: 2 }).notNull(),
  amountPaid: decimal('amount_paid', { precision: 14, scale: 2 }).notNull().default('0.00'),
  creditedAmount: decimal('credited_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  balanceDue: decimal('balance_due', { precision: 14, scale: 2 })
    .generatedAlwaysAs(sql`total - credited_amount - amount_paid`, { mode: 'stored' }),
  settlementStatus: mysqlEnum('settlement_status', invoiceSettlementStatuses)
    .notNull().default('open'),
  soldAt: timestamp('sold_at', { mode: 'date', fsp: 3 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_invoices_branch_fk', columns: [table.branchId], foreignColumns: [branches.id] }),
  foreignKey({ name: 'erp_invoices_client_branch_fk', columns: [table.clientId, table.branchId], foreignColumns: [clients.id, clients.branchId] }),
  foreignKey({ name: 'erp_invoices_seller_branch_fk', columns: [table.sellerEmployeeId, table.branchId], foreignColumns: [employees.id, employees.branchId] }),
  foreignKey({ name: 'erp_invoices_account_fk', columns: [table.actingAccountId], foreignColumns: [accounts.id] }),
  foreignKey({ name: 'erp_invoices_session_branch_fk', columns: [table.cashierSessionId, table.branchId], foreignColumns: [cashierSessions.id, cashierSessions.branchId] }),
  // The same rule the clients table enforces, kept on the ledger copy: an
  // invoice must record who it was sold to, by name or by number.
  check(
    'erp_invoices_client_identity_present',
    sql`${table.clientNameSnapshot} is not null or ${table.clientPhoneSnapshot} is not null`,
  ),
  uniqueIndex('erp_invoices_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('erp_invoices_number_unique').on(table.invoiceNumber),
  uniqueIndex('erp_invoices_idempotency_unique').on(table.idempotencyKey),
  index('erp_invoices_branch_sold_idx').on(table.branchId, table.soldAt),
  index('erp_invoices_client_sold_idx').on(table.clientId, table.soldAt),
  index('erp_invoices_seller_sold_idx').on(table.sellerEmployeeId, table.soldAt),
  index('erp_invoices_session_idx').on(table.cashierSessionId),
  check('erp_invoices_subtotal_positive', sql`${table.subtotal} > 0`),
  check(
    'erp_invoices_totals_consistent',
    sql`${table.total} = ${table.subtotal} - ${table.discountAmount} + ${table.taxAmount} and ${table.total} > 0`,
  ),
  check(
    'erp_invoices_amount_paid_valid',
    sql`${table.amountPaid} >= 0 and ${table.creditedAmount} >= 0 and ${table.amountPaid} + ${table.creditedAmount} <= ${table.total}`,
  ),
  check(
    'erp_invoices_settlement_status_consistent',
    sql`(${table.settlementStatus} = 'settled' and ${table.amountPaid} + ${table.creditedAmount} = ${table.total}) or (${table.settlementStatus} = 'open' and ${table.amountPaid} + ${table.creditedAmount} < ${table.total})`,
  ),
  check(
    'erp_invoices_discount_consistent',
    sql`(discount_kind is null and discount_value is null and discount_amount = 0) or (discount_kind is not null and discount_value is not null and discount_value >= 0 and discount_amount >= 0 and discount_amount <= subtotal and (discount_kind <> 'percentage' or discount_value <= 100))`,
  ),
  check(
    'erp_invoices_tax_consistent',
    sql`(tax_kind is null and tax_value is null and tax_amount = 0) or (tax_kind is not null and tax_value is not null and tax_value >= 0 and tax_amount >= 0 and (tax_kind <> 'percentage' or tax_value <= 100))`,
  ),
  check(
    'erp_invoices_seller_consistent',
    sql`(${table.sellerEmployeeId} is null and ${table.sellerNameSnapshot} is null) or (${table.sellerEmployeeId} is not null and ${table.sellerNameSnapshot} is not null)`,
  ),
  // Internal trade names no seller; a customer sale always does.
  check(
    'erp_invoices_transfer_has_no_seller',
    sql`${table.kind} = 'sale' or ${table.sellerEmployeeId} is null`,
  ),
  index('erp_invoices_kind_sold_idx').on(table.kind, table.soldAt),
]);

/**
 * The employees allowed to sell under a branch's shared cashier login.
 * Membership must track the employee's own branch, hence the composite FK.
 */
export const branchCashierRoster = mysqlTable('erp_branch_cashier_roster', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull(),
  employeeId: int('employee_id').notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_branch_cashier_roster_branch_fk', columns: [table.branchId], foreignColumns: [branches.id] }),
  foreignKey({ name: 'erp_branch_cashier_roster_employee_branch_fk', columns: [table.employeeId, table.branchId], foreignColumns: [employees.id, employees.branchId] }),
  uniqueIndex('erp_branch_cashier_roster_branch_employee_unique').on(table.branchId, table.employeeId),
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
  /**
   * The employee who performed this service, so one invoice can pay commission
   * to several people. A product line names nobody and earns nothing.
   */
  employeeId: int('employee_id'),
  employeeNameSnapshot: varchar('employee_name_snapshot', { length: 255 }),
  employeeCodeSnapshot: int('employee_code_snapshot'),
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
  foreignKey({ name: 'erp_invoice_lines_employee_branch_fk', columns: [table.employeeId, table.branchId], foreignColumns: [employees.id, employees.branchId] }),
  uniqueIndex('erp_invoice_lines_invoice_line_unique').on(table.invoiceId, table.lineNumber),
  uniqueIndex('erp_invoice_lines_id_invoice_branch_unique').on(table.id, table.invoiceId, table.branchId),
  index('erp_invoice_lines_service_idx').on(table.serviceId),
  index('erp_invoice_lines_product_idx').on(table.productId),
  index('erp_invoice_lines_employee_idx').on(table.employeeId),
  // A product names nobody. A service names one employee with both snapshots,
  // and may only be employee-free while its invoice is still a draft.
  check(
    'erp_invoice_lines_employee_consistent',
    sql`(item_type = 'product' and employee_id is null and employee_name_snapshot is null and employee_code_snapshot is null) or (item_type = 'service' and ((employee_id is null and employee_name_snapshot is null and employee_code_snapshot is null) or (employee_id is not null and employee_name_snapshot is not null and employee_code_snapshot > 0)))`,
  ),
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

export const invoiceLineReassignments = mysqlTable('erp_invoice_line_reassignments', {
  id: int('id').autoincrement().primaryKey(),
  invoiceId: int('invoice_id').notNull(),
  invoiceLineId: int('invoice_line_id').notNull(),
  branchId: int('branch_id').notNull(),
  fromEmployeeId: int('from_employee_id').notNull(),
  toEmployeeId: int('to_employee_id').notNull(),
  reason: varchar('reason', { length: 1000 }).notNull(),
  operationReference: varchar('operation_reference', { length: 36 }).notNull(),
  actingAccountId: int('acting_account_id').notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_invoice_line_reassignments_line_invoice_branch_fk',
    columns: [table.invoiceLineId, table.invoiceId, table.branchId],
    foreignColumns: [invoiceLines.id, invoiceLines.invoiceId, invoiceLines.branchId],
  }),
  foreignKey({
    name: 'erp_invoice_line_reassignments_from_employee_branch_fk',
    columns: [table.fromEmployeeId, table.branchId],
    foreignColumns: [employees.id, employees.branchId],
  }),
  foreignKey({
    name: 'erp_invoice_line_reassignments_to_employee_branch_fk',
    columns: [table.toEmployeeId, table.branchId],
    foreignColumns: [employees.id, employees.branchId],
  }),
  foreignKey({
    name: 'erp_invoice_line_reassignments_acting_account_fk',
    columns: [table.actingAccountId], foreignColumns: [accounts.id],
  }),
  uniqueIndex('erp_invoice_line_reassignments_line_operation_unique')
    .on(table.operationReference),
  index('erp_invoice_line_reassignments_line_created_idx')
    .on(table.invoiceLineId, table.createdAt, table.id),
  check('erp_invoice_line_reassignments_employee_changed', sql`${table.fromEmployeeId} <> ${table.toEmployeeId}`),
  check('erp_invoice_line_reassignments_reason_required', sql`CHAR_LENGTH(TRIM(${table.reason})) > 0`),
]);

export const invoicePayments = mysqlTable('erp_invoice_payments', {
  id: int('id').autoincrement().primaryKey(),
  invoiceId: int('invoice_id').notNull(),
  method: mysqlEnum('method', erpPaymentMethods).notNull(),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  operationReference: varchar('operation_reference', { length: 36 }).notNull(),
  isInitial: boolean('is_initial').notNull().default(true),
  /**
   * The shift that actually took this money, the account that took it, and when.
   * Today they always match the invoice, but once an invoice can be paid in
   * instalments a later payment belongs to a later shift, so the till summary is
   * counted from these columns rather than from the invoice.
   */
  cashierSessionId: int('cashier_session_id').notNull(),
  actingAccountId: int('acting_account_id').notNull(),
  paidAt: timestamp('paid_at', { mode: 'date', fsp: 3 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_invoice_payments_invoice_fk', columns: [table.invoiceId], foreignColumns: [invoices.id] }),
  foreignKey({ name: 'erp_invoice_payments_session_fk', columns: [table.cashierSessionId], foreignColumns: [cashierSessions.id] }),
  foreignKey({ name: 'erp_invoice_payments_account_fk', columns: [table.actingAccountId], foreignColumns: [accounts.id] }),
  uniqueIndex('erp_invoice_payments_invoice_reference_unique')
    .on(table.invoiceId, table.operationReference),
  // Lets a refund line point at a payment and its invoice together, so it cannot name a
  // payment that belongs to a different invoice.
  uniqueIndex('erp_invoice_payments_id_invoice_unique').on(table.id, table.invoiceId),
  index('erp_invoice_payments_session_paid_idx').on(table.cashierSessionId, table.paidAt),
  check('erp_invoice_payments_amount_positive', sql`${table.amount} > 0`),
]);

export const invoiceReversals = mysqlTable('erp_invoice_reversals', {
  id: int('id').autoincrement().primaryKey(),
  invoiceId: int('invoice_id').notNull(),
  branchId: int('branch_id').notNull(),
  type: mysqlEnum('type', ['void', 'refund']).notNull(),
  status: mysqlEnum('status', ['pending', 'finalized']).default('pending').notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 36 }).notNull(),
  reason: varchar('reason', { length: 1000 }).notNull(),
  actingAccountId: int('acting_account_id').notNull(),
  approvingAccountId: int('approving_account_id'),
  grossAmount: decimal('gross_amount', { precision: 14, scale: 2 }).notNull(),
  discountAmount: decimal('discount_amount', { precision: 14, scale: 2 }).notNull(),
  taxAmount: decimal('tax_amount', { precision: 14, scale: 2 }).notNull(),
  total: decimal('total', { precision: 14, scale: 2 }).notNull(),
  businessDate: date('business_date', { mode: 'string' }).notNull(),
  /**
   * The shift the money was handed back in, which is not the shift that sold the
   * invoice. Null when no till was open — an admin may refund outside a shift.
   */
  cashierSessionId: int('cashier_session_id'),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  // Branch-scoped like the invoice's own session link: an id-only reference would let a
  // refund be attributed to a till in another branch.
  foreignKey({ name: 'erp_invoice_reversals_session_branch_fk', columns: [table.cashierSessionId, table.branchId], foreignColumns: [cashierSessions.id, cashierSessions.branchId] }),
  index('erp_invoice_reversals_session_created_idx').on(table.cashierSessionId, table.createdAt),
  foreignKey({ name: 'erp_invoice_reversals_invoice_branch_fk', columns: [table.invoiceId, table.branchId], foreignColumns: [invoices.id, invoices.branchId] }),
  foreignKey({ name: 'erp_invoice_reversals_acting_account_fk', columns: [table.actingAccountId], foreignColumns: [accounts.id] }),
  foreignKey({ name: 'erp_invoice_reversals_approving_account_fk', columns: [table.approvingAccountId], foreignColumns: [accounts.id] }),
  uniqueIndex('erp_invoice_reversals_idempotency_unique').on(table.idempotencyKey),
  uniqueIndex('erp_invoice_reversals_id_invoice_unique').on(table.id, table.invoiceId),
  index('erp_invoice_reversals_invoice_created_idx').on(table.invoiceId, table.createdAt),
  check('erp_invoice_reversals_reason_required', sql`CHAR_LENGTH(TRIM(${table.reason})) > 0`),
  check('erp_invoice_reversals_amounts_consistent', sql`${table.grossAmount} > 0 and ${table.discountAmount} >= 0 and ${table.taxAmount} >= 0 and ${table.total} = ${table.grossAmount} - ${table.discountAmount} + ${table.taxAmount} and ${table.total} >= 0`),
]);

export const invoiceReversalLines = mysqlTable('erp_invoice_reversal_lines', {
  id: int('id').autoincrement().primaryKey(),
  reversalId: int('reversal_id').notNull(),
  invoiceId: int('invoice_id').notNull(),
  invoiceLineId: int('invoice_line_id').notNull(),
  branchId: int('branch_id').notNull(),
  quantity: int('quantity').notNull(),
  grossAmount: decimal('gross_amount', { precision: 14, scale: 2 }).notNull(),
  discountAmount: decimal('discount_amount', { precision: 14, scale: 2 }).notNull(),
  taxAmount: decimal('tax_amount', { precision: 14, scale: 2 }).notNull(),
  total: decimal('total', { precision: 14, scale: 2 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_reversal_lines_reversal_fk', columns: [table.reversalId], foreignColumns: [invoiceReversals.id] }),
  foreignKey({ name: 'erp_reversal_lines_invoice_fk', columns: [table.invoiceId], foreignColumns: [invoices.id] }),
  foreignKey({ name: 'erp_reversal_lines_line_fk', columns: [table.invoiceLineId], foreignColumns: [invoiceLines.id] }),
  foreignKey({ name: 'erp_reversal_lines_branch_fk', columns: [table.branchId], foreignColumns: [branches.id] }),
  uniqueIndex('erp_invoice_reversal_lines_reversal_line_unique').on(table.reversalId, table.invoiceLineId),
  check('erp_invoice_reversal_lines_amounts_consistent', sql`${table.quantity} > 0 and ${table.grossAmount} > 0 and ${table.discountAmount} >= 0 and ${table.taxAmount} >= 0 and ${table.total} = ${table.grossAmount} - ${table.discountAmount} + ${table.taxAmount} and ${table.total} >= 0`),
]);

export const invoiceReversalPayments = mysqlTable('erp_invoice_reversal_payments', {
  id: int('id').autoincrement().primaryKey(),
  reversalId: int('reversal_id').notNull(),
  /**
   * Carried so the database can check that the reversal and the payment being reversed
   * are the same invoice's, which no single-column reference can express.
   */
  invoiceId: int('invoice_id').notNull(),
  /**
   * The original payment this refund reverses, when there is one. A refund may be
   * handed back on a method the sale never used, or for more than what is left on
   * the matching payment; either way it stands on its own and this stays null.
   */
  invoicePaymentId: int('invoice_payment_id'),
  methodSnapshot: mysqlEnum('method_snapshot', erpPaymentMethods).notNull(),
  /** Physical money returned; `amount` also includes debt cancelled by the return. */
  cashAmount: decimal('cash_amount', { precision: 14, scale: 2 }).notNull(),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_reversal_payments_reversal_invoice_fk', columns: [table.reversalId, table.invoiceId], foreignColumns: [invoiceReversals.id, invoiceReversals.invoiceId] }),
  // Null invoice_payment_id skips this check, which is what an unlinked refund needs.
  foreignKey({ name: 'erp_reversal_payments_payment_invoice_fk', columns: [table.invoicePaymentId, table.invoiceId], foreignColumns: [invoicePayments.id, invoicePayments.invoiceId] }),
  uniqueIndex('erp_invoice_reversal_payments_method_unique').on(table.reversalId, table.methodSnapshot),
  check('erp_invoice_reversal_payments_amount_positive', sql`${table.amount} > 0`),
  check('erp_invoice_reversal_payments_cash_valid', sql`${table.cashAmount} >= 0 and ${table.cashAmount} <= ${table.amount}`),
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
  entryType: mysqlEnum('entry_type', ['earned', 'reversal', 'reassignment_out', 'reassignment_in']).notNull(),
  reversesEntryId: int('reverses_entry_id'),
  invoiceReversalId: int('invoice_reversal_id'),
  invoiceLineReassignmentId: int('invoice_line_reassignment_id'),
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
  foreignKey({
    name: 'erp_commission_ledger_line_reassignment_fk',
    columns: [table.invoiceLineReassignmentId],
    foreignColumns: [invoiceLineReassignments.id],
  }),
  foreignKey({
    name: 'erp_commission_ledger_invoice_reversal_fk',
    columns: [table.invoiceReversalId],
    foreignColumns: [invoiceReversals.id],
  }),
  uniqueIndex('erp_commission_ledger_original_line_unique').on(table.originalInvoiceLineId),
  index('erp_commission_ledger_employee_created_idx').on(table.employeeId, table.createdAt),
  index('erp_commission_ledger_invoice_idx').on(table.invoiceId),
  index('erp_commission_ledger_reversal_idx').on(table.reversesEntryId),
  check(
    'erp_commission_ledger_entry_consistent',
    sql`(entry_type = 'earned' and reverses_entry_id is null and invoice_reversal_id is null and invoice_line_reassignment_id is null) or (entry_type = 'reversal' and reverses_entry_id is not null and invoice_reversal_id is not null and invoice_line_reassignment_id is null) or (entry_type in ('reassignment_out', 'reassignment_in') and reverses_entry_id is null and invoice_reversal_id is null and invoice_line_reassignment_id is not null)`,
  ),
  check(
    'erp_commission_ledger_amount_direction',
    sql`${table.baseAmount} > 0 and ${table.commissionRateSnapshot} between 0 and 100 and ((entry_type in ('earned', 'reassignment_in') and amount >= 0) or (entry_type in ('reversal', 'reassignment_out') and amount <= 0))`,
  ),
]);
