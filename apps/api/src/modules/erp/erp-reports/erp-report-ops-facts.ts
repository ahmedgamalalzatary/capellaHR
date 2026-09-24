import type { ReportFilters } from '@capella/contracts';
import { sql } from 'drizzle-orm';

import {
  branchFilter,
  condition,
  currentQueueEmployeeName,
  dateFilter,
  saleLineEvents,
  searchFilter,
  timestampFilter,
} from './erp-report-sql.js';

export const expenseFacts = (filters: ReportFilters) => sql`
  SELECT expense.id id, expense.expense_date eventDate, branch.name branchName,
    expense.name expenseName, expense.description description, expense.kind eventType,
    account.username authorizedBy,
    CASE WHEN expense.kind = 'reversal' THEN -expense.amount ELSE expense.amount END amount
  FROM erp_expenses expense
  INNER JOIN branches branch ON branch.id = expense.branch_id
  INNER JOIN accounts account ON account.id = expense.acting_account_id
  ${condition([
    ...branchFilter(filters, 'expense.branch_id'), ...dateFilter(filters, 'expense.expense_date'),
    ...searchFilter(filters, ['expense.name', 'expense.description', 'account.username']),
  ])}
`;

export const purchaseFacts = (filters: ReportFilters) => sql`
  SELECT CONCAT('purchase-', purchase.id) id, purchase.purchase_date eventDate,
    branch.name branchName, purchase.supplier_name_snapshot supplierName,
    'purchase' eventType, purchase.status status, account.username authorizedBy,
    purchase.total amount
  FROM erp_purchases purchase
  INNER JOIN branches branch ON branch.id = purchase.branch_id
  INNER JOIN accounts account ON account.id = purchase.acting_account_id
  ${condition([
    sql`purchase.status IN ('posted', 'cancelled')`, ...branchFilter(filters, 'purchase.branch_id'),
    ...dateFilter(filters, 'purchase.purchase_date'),
    ...searchFilter(filters, ['purchase.supplier_name_snapshot', 'account.username']),
  ])}
  UNION ALL
  SELECT CONCAT('purchase-cancellation-', purchase.id) id, purchase.cancelled_at eventDate,
    branch.name branchName, purchase.supplier_name_snapshot supplierName,
    'purchase_cancellation' eventType, purchase.status status,
    cancelled_account.username authorizedBy, -purchase.total amount
  FROM erp_purchases purchase
  INNER JOIN branches branch ON branch.id = purchase.branch_id
  INNER JOIN accounts cancelled_account ON cancelled_account.id = purchase.cancelled_by_account_id
  ${condition([
    sql`purchase.status = 'cancelled'`, ...branchFilter(filters, 'purchase.branch_id'),
    ...timestampFilter(filters, 'purchase.cancelled_at'),
    ...searchFilter(filters, ['purchase.supplier_name_snapshot', 'cancelled_account.username']),
  ])}
`;
export const transferFacts = (filters: ReportFilters) => sql`
  SELECT line.id id, transfer.transfer_date eventDate,
    source_branch.name sourceBranchName, destination_branch.name destinationBranchName,
    line.product_name_snapshot productName, line.quantity quantity,
    line.unit_cost unitCost, line.line_total totalCost,
    account.username authorizedBy, transfer.note note
  FROM erp_stock_transfer_lines line
  INNER JOIN erp_stock_transfers transfer ON transfer.id = line.transfer_id
    AND transfer.source_branch_id = line.source_branch_id
    AND transfer.destination_branch_id = line.destination_branch_id
  INNER JOIN branches source_branch ON source_branch.id = transfer.source_branch_id
  INNER JOIN branches destination_branch ON destination_branch.id = transfer.destination_branch_id
  INNER JOIN accounts account ON account.id = transfer.acting_account_id
  ${condition([
    sql`transfer.status = 'posted'`,
    ...(filters.sourceBranchId === undefined ? [] : [sql`transfer.source_branch_id = ${filters.sourceBranchId}`]),
    ...(filters.destinationBranchId === undefined ? [] : [sql`transfer.destination_branch_id = ${filters.destinationBranchId}`]),
    ...dateFilter(filters, 'transfer.transfer_date'),
    ...searchFilter(filters, [
      'source_branch.name', 'destination_branch.name', 'line.product_name_snapshot',
      'account.username', 'transfer.note',
    ]),
  ])}
`;

export const stockFacts = (filters: ReportFilters) => sql`
  SELECT product.id id, stock.updated_at eventDate, branch.name branchName,
    product.name productName, stock.quantity availableQuantity,
    product.last_purchase_cost unitCost,
    stock.quantity * product.last_purchase_cost inventoryValue
  FROM erp_product_stocks stock
  INNER JOIN erp_products product
    ON product.id = stock.product_id AND product.branch_id = stock.branch_id
  INNER JOIN branches branch ON branch.id = stock.branch_id
  ${condition([
    ...branchFilter(filters, 'stock.branch_id'), ...timestampFilter(filters, 'stock.updated_at'),
    ...searchFilter(filters, ['product.name', 'product.barcode']),
  ])}
`;

export const profitFacts = (filters: ReportFilters) => saleLineEvents(filters, 'product', (args) => sql`
  SELECT ${args.id} id, ${args.eventDate} eventDate, ${sql.raw(args.branch)}.name branchName,
    ${sql.raw(args.invoice)}.invoice_number invoiceNumber,
    ${sql.raw(args.line)}.item_name_snapshot productName, ${args.eventType} eventType,
    ${args.quantity} quantity, ${args.amount} revenue,
    ${args.quantity} * ${sql.raw(args.line)}.product_cost_basis_snapshot cost,
    ${args.amount} - (${args.quantity} * ${sql.raw(args.line)}.product_cost_basis_snapshot) profit
`);
export const serviceQueueFacts = (filters: ReportFilters) => sql`
  SELECT queue.id id, queue.created_at eventDate, branch.name branchName,
    queue.cashier_session_id shiftId, line.item_name_snapshot serviceName,
    queue.queue_number queueNumber, invoice.invoice_number invoiceNumber,
    invoice.client_name_snapshot clientName,
    ${sql.raw(currentQueueEmployeeName)} employeeName,
    invoice.authorized_by_snapshot authorizedBy, queue.status status,
    queue.completed_at completedAt
  FROM erp_service_queue_entries queue
  INNER JOIN erp_invoices invoice
    ON invoice.id = queue.invoice_id AND invoice.branch_id = queue.branch_id
  INNER JOIN erp_invoice_lines line
    ON line.id = queue.invoice_line_id AND line.invoice_id = queue.invoice_id
      AND line.branch_id = queue.branch_id
  INNER JOIN branches branch ON branch.id = queue.branch_id
  ${condition([
    sql`invoice.status <> 'draft'`,
    ...branchFilter(filters, 'queue.branch_id'),
    ...timestampFilter(filters, 'queue.created_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'invoice.client_name_snapshot',
      'line.item_name_snapshot', currentQueueEmployeeName,
      'invoice.authorized_by_snapshot', 'CAST(queue.queue_number AS CHAR)',
      'CAST(queue.cashier_session_id AS CHAR)',
    ]),
  ])}
`;

export const serviceCompletionFacts = (filters: ReportFilters) => sql`
  SELECT queue.id id, queue.completed_at eventDate, branch.name branchName,
    queue.cashier_session_id shiftId, line.item_name_snapshot serviceName,
    queue.queue_number queueNumber, invoice.invoice_number invoiceNumber,
    invoice.client_name_snapshot clientName, ${sql.raw(currentQueueEmployeeName)} employeeName,
    COALESCE(report.completion_kind, 'unrecorded') completionKind,
    COALESCE(GROUP_CONCAT(CONCAT(product.name, ' ', consumption_usage.quantity, ' ', consumption_usage.unit)
      ORDER BY product.name SEPARATOR '، '), '') consumables,
    COALESCE(SUM(consumption_usage.total_cost), 0) totalCost
  FROM erp_service_queue_entries queue
  LEFT JOIN erp_service_consumption_reports report
    ON report.service_queue_entry_id = queue.id AND report.is_current = true
  INNER JOIN erp_invoices invoice ON invoice.id = queue.invoice_id AND invoice.branch_id = queue.branch_id
  INNER JOIN erp_invoice_lines line ON line.id = queue.invoice_line_id AND line.invoice_id = queue.invoice_id
  INNER JOIN branches branch ON branch.id = queue.branch_id
  LEFT JOIN erp_service_consumption_usages consumption_usage ON consumption_usage.report_id = report.id
  LEFT JOIN erp_products product ON product.id = consumption_usage.product_id
  ${condition([
    sql`queue.status = 'completed'`, ...branchFilter(filters, 'queue.branch_id'),
    ...timestampFilter(filters, 'queue.completed_at'),
    ...searchFilter(filters, ['invoice.invoice_number', 'invoice.client_name_snapshot', 'line.item_name_snapshot', currentQueueEmployeeName, 'product.name']),
  ])}
  GROUP BY queue.id, queue.completed_at, branch.name, queue.cashier_session_id,
    line.item_name_snapshot, queue.queue_number, invoice.invoice_number,
    invoice.client_name_snapshot, employeeName, report.completion_kind
`;

export const consumableUsageFacts = (filters: ReportFilters) => sql`
  SELECT consumption_usage.id id, report.created_at eventDate, branch.name branchName,
    product.name productName, consumption_usage.unit unit, line.item_name_snapshot serviceName,
    ${sql.raw(currentQueueEmployeeName)} employeeName, consumption_usage.quantity quantity, consumption_usage.total_cost cost
  FROM erp_service_consumption_usages consumption_usage
  INNER JOIN erp_service_consumption_reports report ON report.id = consumption_usage.report_id
  INNER JOIN erp_service_queue_entries queue ON queue.id = report.service_queue_entry_id
  INNER JOIN erp_invoice_lines line ON line.id = queue.invoice_line_id
  INNER JOIN erp_products product ON product.id = consumption_usage.product_id
  INNER JOIN branches branch ON branch.id = consumption_usage.branch_id
  ${condition([
    sql`report.is_current = true`, ...branchFilter(filters, 'consumption_usage.branch_id'),
    ...timestampFilter(filters, 'report.created_at'),
    ...searchFilter(filters, ['product.name', 'line.item_name_snapshot', currentQueueEmployeeName]),
  ])}
`;

export const consumableLedgerFacts = (filters: ReportFilters) => sql`
  SELECT ledger.id id, ledger.created_at eventDate, branch.name branchName,
    product.name productName, config.unit unit, ledger.entry_type entryType,
    ledger.quantity_delta quantityDelta, ledger.balance_after balanceAfter,
    ledger.unit_cost_snapshot unitCost, ledger.total_cost totalCost,
    account.username actingUsername, ledger.note note
  FROM erp_consumable_ledger_entries ledger
  INNER JOIN erp_products product ON product.id = ledger.product_id
  INNER JOIN erp_consumable_configurations config ON config.product_id = ledger.product_id AND config.branch_id = ledger.branch_id
  INNER JOIN branches branch ON branch.id = ledger.branch_id
  INNER JOIN accounts account ON account.id = ledger.acting_account_id
  ${condition([
    ...branchFilter(filters, 'ledger.branch_id'), ...timestampFilter(filters, 'ledger.created_at'),
    ...searchFilter(filters, ['product.name', 'account.username', 'ledger.note']),
  ])}
`;

export const serviceExceptionFacts = (filters: ReportFilters) => sql`
  SELECT queue.id id, queue.created_at eventDate, branch.name branchName,
    queue.cashier_session_id shiftId, line.item_name_snapshot serviceName,
    queue.queue_number queueNumber, invoice.invoice_number invoiceNumber,
    invoice.client_name_snapshot clientName, ${sql.raw(currentQueueEmployeeName)} employeeName
  FROM erp_service_queue_entries queue
  INNER JOIN erp_invoices invoice ON invoice.id = queue.invoice_id AND invoice.branch_id = queue.branch_id
  INNER JOIN erp_invoice_lines line ON line.id = queue.invoice_line_id
  INNER JOIN branches branch ON branch.id = queue.branch_id
  ${condition([
    sql`queue.status = 'overdue'`, ...branchFilter(filters, 'queue.branch_id'),
    ...timestampFilter(filters, 'queue.created_at'),
    ...searchFilter(filters, ['invoice.invoice_number', 'invoice.client_name_snapshot', 'line.item_name_snapshot', currentQueueEmployeeName]),
  ])}
`;
