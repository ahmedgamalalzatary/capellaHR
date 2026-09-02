import type { ReportCell, ReportFilters, ReportSelection } from '@capella/contracts';
import type { createDatabase } from '@capella/database';
import { sql, type SQL } from 'drizzle-orm';

import { startOfCairoDate } from '../cairo-calendar.js';
import type {
  ErpReportPage,
  ErpReportPagination,
  ErpReportRepository,
  ErpReportType,
} from './erp-report-reader.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type RawRow = Record<string, unknown>;

const rawRows = async <T>(query: ReturnType<Transaction['execute']>) => (
  (await query)[0] as unknown as T[]
);

const nextDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

const condition = (parts: SQL[]) => parts.length
  ? sql` WHERE ${sql.join(parts, sql` AND `)}`
  : sql``;

const branchFilter = (filters: ReportFilters, expression: string): SQL[] => (
  filters.branchId === undefined ? [] : [sql`${sql.raw(expression)} = ${filters.branchId}`]
);

const dateFilter = (filters: ReportFilters, expression: string): SQL[] => [
  ...(filters.dateFrom ? [sql`${sql.raw(expression)} >= ${filters.dateFrom}`] : []),
  ...(filters.dateTo ? [sql`${sql.raw(expression)} <= ${filters.dateTo}`] : []),
];

const timestampFilter = (filters: ReportFilters, expression: string): SQL[] => [
  ...(filters.dateFrom
    ? [sql`${sql.raw(expression)} >= ${startOfCairoDate(filters.dateFrom)}`]
    : []),
  ...(filters.dateTo
    ? [sql`${sql.raw(expression)} < ${startOfCairoDate(nextDate(filters.dateTo))}`]
    : []),
];

const searchFilter = (filters: ReportFilters, expressions: string[]): SQL[] => {
  if (!filters.search) return [];
  return [sql`(${sql.join(expressions.map((expression) => (
    sql`LOCATE(${filters.search}, ${sql.raw(expression)}) > 0`
  )), sql` OR `)})`];
};

/**
 * One line's share of an invoice-level amount, allocated by cumulative rounding
 * in line order: the running total up to this line minus the running total
 * before it. Every line's share is exact to the cent and the shares of all the
 * lines add back up to the invoice amount, with none lost or invented.
 */
const invoiceLineShare = (lineAlias: string, invoiceAlias: string, amountColumn: string) => {
  const line = sql.raw(lineAlias);
  const amount = sql.raw(`${invoiceAlias}.${amountColumn}`);
  const invoice = sql.raw(invoiceAlias);
  return sql`ROUND(${amount} * (
    SELECT COALESCE(SUM(prefix.line_total), 0)
    FROM erp_invoice_lines prefix
    WHERE prefix.invoice_id = ${line}.invoice_id
      AND prefix.branch_id = ${line}.branch_id
      AND prefix.line_number <= ${line}.line_number
  ) / NULLIF(${invoice}.subtotal, 0), 2) - ROUND(${amount} * (
    SELECT COALESCE(SUM(prefix.line_total), 0)
    FROM erp_invoice_lines prefix
    WHERE prefix.invoice_id = ${line}.invoice_id
      AND prefix.branch_id = ${line}.branch_id
      AND prefix.line_number < ${line}.line_number
  ) / NULLIF(${invoice}.subtotal, 0), 2)`;
};

const invoiceLineDiscount = (lineAlias: string, invoiceAlias: string) => (
  invoiceLineShare(lineAlias, invoiceAlias, 'discount_amount')
);

/**
 * An invoice no longer names one employee: each service line names its own, so
 * invoice-level columns list every distinct name (or code) behind the sale.
 */
const invoiceEmployeeList = (invoiceAlias: string, column: 'name' | 'code') => {
  const invoice = sql.raw(invoiceAlias);
  const field = sql.raw(column === 'name' ? 'employee_name_snapshot' : 'employee_code_snapshot');
  return sql`(
    SELECT GROUP_CONCAT(DISTINCT employee_line.${field} ORDER BY employee_line.${field} SEPARATOR ' | ')
    FROM erp_invoice_lines employee_line
    WHERE employee_line.invoice_id = ${invoice}.id
      AND employee_line.branch_id = ${invoice}.branch_id
      AND employee_line.employee_id IS NOT NULL
  )`;
};

const saleLineEvents = (
  filters: ReportFilters,
  itemType: 'service' | 'product',
  projection: (args: {
    line: string;
    invoice: string;
    branch: string;
    amount: SQL;
    quantity: SQL;
    eventType: SQL;
    eventDate: SQL;
    id: SQL;
  }) => SQL,
) => {
  const lineConditions = [
    sql`line.item_type = ${itemType}`,
    sql`invoice.status <> 'draft'`,
    // Internal trade between branches is not a unit sold, cash taken or a
    // client's spend; only the sales report shows it, labelled as a transfer.
    sql`invoice.kind = 'sale'`,
    ...branchFilter(filters, 'invoice.branch_id'),
    ...timestampFilter(filters, 'invoice.sold_at'),
    ...searchFilter(filters, [
      'line.item_name_snapshot', 'invoice.invoice_number',
      'invoice.client_name_snapshot', 'line.employee_name_snapshot',
    ]),
  ];
  const reversalConditions = [
    sql`original_line.item_type = ${itemType}`,
    sql`reversal.status = 'finalized'`,
    ...branchFilter(filters, 'reversal.branch_id'),
    ...timestampFilter(filters, 'reversal.created_at'),
    ...searchFilter(filters, [
      'original_line.item_name_snapshot', 'invoice.invoice_number',
      'invoice.client_name_snapshot', 'original_line.employee_name_snapshot',
    ]),
  ];
  const lineAmount = sql`line.line_total - (${invoiceLineDiscount('line', 'invoice')})`;
  return sql`
    ${projection({
      line: 'line', invoice: 'invoice', branch: 'branch', amount: lineAmount,
      quantity: sql`line.quantity`, eventType: sql`'sale'`, eventDate: sql`invoice.sold_at`,
      id: sql`CONCAT('sale-', line.id)`,
    })}
    FROM erp_invoice_lines line
    INNER JOIN erp_invoices invoice
      ON invoice.id = line.invoice_id AND invoice.branch_id = line.branch_id
    INNER JOIN branches branch ON branch.id = invoice.branch_id
    ${condition(lineConditions)}
    UNION ALL
    ${projection({
      line: 'original_line', invoice: 'invoice', branch: 'branch',
      amount: sql`-(reversal_line.gross_amount - reversal_line.discount_amount)`,
      quantity: sql`-reversal_line.quantity`, eventType: sql`reversal.type`,
      eventDate: sql`reversal.created_at`, id: sql`CONCAT(reversal.type, '-', reversal_line.id)`,
    })}
    FROM erp_invoice_reversal_lines reversal_line
    INNER JOIN erp_invoice_reversals reversal
      ON reversal.id = reversal_line.reversal_id
      AND reversal.invoice_id = reversal_line.invoice_id
      AND reversal.branch_id = reversal_line.branch_id
    INNER JOIN erp_invoice_lines original_line
      ON original_line.id = reversal_line.invoice_line_id
      AND original_line.invoice_id = reversal_line.invoice_id
      AND original_line.branch_id = reversal_line.branch_id
    INNER JOIN erp_invoices invoice
      ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
    INNER JOIN branches branch ON branch.id = reversal.branch_id
    ${condition(reversalConditions)}
  `;
};

const salesFacts = (filters: ReportFilters) => sql`
  SELECT invoice.id id, invoice.sold_at eventDate, invoice.invoice_number invoiceNumber,
    invoice.sold_at businessDate, branch.name branchName,
    invoice.client_name_snapshot clientName, invoice.client_phone_snapshot clientPhone,
    ${invoiceEmployeeList('invoice', 'name')} employeeName,
    invoice.authorized_by_snapshot authorizedBy,
    CASE WHEN invoice.kind = 'branch_transfer' THEN 'تحويل بين الفروع' ELSE 'بيع' END saleKind,
    invoice.subtotal subtotal, invoice.discount_amount discountAmount,
    invoice.tax_amount taxAmount, invoice.total total
  FROM erp_invoices invoice
  INNER JOIN branches branch ON branch.id = invoice.branch_id
  ${condition([
    sql`invoice.status <> 'draft'`,
    ...branchFilter(filters, 'invoice.branch_id'),
    ...timestampFilter(filters, 'invoice.sold_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'invoice.client_name_snapshot', 'invoice.client_phone_snapshot',
      'invoice.authorized_by_snapshot',
    ]),
  ])}
`;

const paymentFacts = (filters: ReportFilters) => sql`
  SELECT CONCAT('sale-', payment.id) id, payment.paid_at eventDate, branch.name branchName,
    invoice.invoice_number invoiceNumber, 'sale' eventType,
    payment.method paymentMethod, payment.amount amount
  FROM erp_invoice_payments payment
  INNER JOIN erp_invoices invoice ON invoice.id = payment.invoice_id
  INNER JOIN branches branch ON branch.id = invoice.branch_id
  ${condition([
    sql`invoice.status <> 'draft'`,
    sql`invoice.kind = 'sale'`,
    ...branchFilter(filters, 'invoice.branch_id'),
    ...timestampFilter(filters, 'payment.paid_at'),
    ...searchFilter(filters, ['invoice.invoice_number', 'payment.method']),
  ])}
  UNION ALL
  SELECT CONCAT(reversal.type, '-', reversal_payment.id) id, reversal.created_at eventDate,
    branch.name branchName, invoice.invoice_number invoiceNumber, reversal.type eventType,
    reversal_payment.method_snapshot paymentMethod, -reversal_payment.cash_amount amount
  FROM erp_invoice_reversal_payments reversal_payment
  INNER JOIN erp_invoice_reversals reversal ON reversal.id = reversal_payment.reversal_id
  -- Never joined back to the original payment: money handed back on a method the
  -- sale never used has none, and it still left the till.
  INNER JOIN erp_invoices invoice
    ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
  INNER JOIN branches branch ON branch.id = reversal.branch_id
  ${condition([
    sql`reversal.status = 'finalized'`,
    sql`reversal_payment.cash_amount > 0`,
    ...branchFilter(filters, 'reversal.branch_id'),
    ...timestampFilter(filters, 'reversal.created_at'),
    ...searchFilter(filters, ['invoice.invoice_number', 'reversal_payment.method_snapshot']),
  ])}
`;

const serviceFacts = (filters: ReportFilters) => saleLineEvents(filters, 'service', (args) => sql`
  SELECT ${args.id} id, ${args.eventDate} eventDate, ${sql.raw(args.branch)}.name branchName,
    ${sql.raw(args.invoice)}.invoice_number invoiceNumber,
    ${sql.raw(args.line)}.item_name_snapshot serviceName,
    ${sql.raw(args.line)}.employee_name_snapshot employeeName, ${args.eventType} eventType,
    ${args.quantity} quantity, ${sql.raw(args.line)}.unit_price unitPrice, ${args.amount} amount
`);

const productFacts = (filters: ReportFilters) => saleLineEvents(filters, 'product', (args) => sql`
  SELECT ${args.id} id, ${args.eventDate} eventDate, ${sql.raw(args.branch)}.name branchName,
    ${sql.raw(args.invoice)}.invoice_number invoiceNumber,
    ${sql.raw(args.line)}.item_name_snapshot productName, ${args.eventType} eventType,
    ${args.quantity} quantity, ${sql.raw(args.line)}.unit_price unitPrice,
    ${sql.raw(args.line)}.product_cost_basis_snapshot costBasis, ${args.amount} amount
`);

/**
 * An employee is credited the services they themselves performed, never the
 * whole invoice: one sale split between three people produces three rows, each
 * carrying its own lines plus that share of the invoice's discount and tax.
 */
const employeeFacts = (filters: ReportFilters) => sql`
  SELECT CONCAT('sale-', invoice.id, '-', line.employee_id) id, invoice.sold_at eventDate,
    branch.name branchName, invoice.invoice_number invoiceNumber,
    line.employee_code_snapshot employeeCode, line.employee_name_snapshot employeeName,
    'sale' eventType,
    SUM(
      line.line_total
        - (${invoiceLineShare('line', 'invoice', 'discount_amount')})
        + (${invoiceLineShare('line', 'invoice', 'tax_amount')})
    ) amount
  FROM erp_invoice_lines line
  INNER JOIN erp_invoices invoice
    ON invoice.id = line.invoice_id AND invoice.branch_id = line.branch_id
  INNER JOIN branches branch ON branch.id = invoice.branch_id
  ${condition([
    sql`invoice.status <> 'draft'`, sql`line.employee_id IS NOT NULL`,
    ...branchFilter(filters, 'invoice.branch_id'),
    ...timestampFilter(filters, 'invoice.sold_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'line.employee_name_snapshot',
      'CAST(line.employee_code_snapshot AS CHAR)',
    ]),
  ])}
  GROUP BY invoice.id, branch.name, invoice.invoice_number, invoice.sold_at,
    invoice.discount_amount, invoice.tax_amount, invoice.subtotal,
    line.employee_id, line.employee_code_snapshot, line.employee_name_snapshot
  UNION ALL
  SELECT CONCAT(reversal.type, '-', reversal.id, '-', original_line.employee_id) id,
    reversal.created_at eventDate, branch.name branchName, invoice.invoice_number invoiceNumber,
    original_line.employee_code_snapshot employeeCode,
    original_line.employee_name_snapshot employeeName,
    reversal.type eventType, -SUM(reversal_line.total) amount
  FROM erp_invoice_reversal_lines reversal_line
  INNER JOIN erp_invoice_reversals reversal
    ON reversal.id = reversal_line.reversal_id
    AND reversal.invoice_id = reversal_line.invoice_id
    AND reversal.branch_id = reversal_line.branch_id
  INNER JOIN erp_invoice_lines original_line
    ON original_line.id = reversal_line.invoice_line_id
    AND original_line.invoice_id = reversal_line.invoice_id
    AND original_line.branch_id = reversal_line.branch_id
  INNER JOIN erp_invoices invoice
    ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
  INNER JOIN branches branch ON branch.id = reversal.branch_id
  ${condition([
    sql`reversal.status = 'finalized'`, sql`original_line.employee_id IS NOT NULL`,
    ...branchFilter(filters, 'reversal.branch_id'),
    ...timestampFilter(filters, 'reversal.created_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'original_line.employee_name_snapshot',
      'CAST(original_line.employee_code_snapshot AS CHAR)',
    ]),
  ])}
  GROUP BY reversal.id, reversal.type, reversal.created_at, branch.name, invoice.invoice_number,
    original_line.employee_id, original_line.employee_code_snapshot,
    original_line.employee_name_snapshot
`;

const commissionFacts = (filters: ReportFilters) => sql`
  SELECT ledger.id id, ledger.created_at eventDate, branch.name branchName,
    invoice.invoice_number invoiceNumber, line.employee_name_snapshot employeeName,
    line.item_name_snapshot serviceName, ledger.entry_type eventType,
    ledger.commission_rate_snapshot commissionRate, ledger.base_amount baseAmount,
    ledger.amount amount
  FROM erp_commission_ledger_entries ledger
  INNER JOIN erp_invoices invoice ON invoice.id = ledger.invoice_id
  INNER JOIN erp_invoice_lines line
    ON line.id = ledger.invoice_line_id AND line.invoice_id = ledger.invoice_id
      AND line.branch_id = invoice.branch_id AND line.employee_id = ledger.employee_id
  LEFT JOIN erp_invoice_reversals reversal
    ON reversal.id = ledger.invoice_reversal_id
      AND reversal.invoice_id = ledger.invoice_id
      AND reversal.branch_id = invoice.branch_id
  INNER JOIN branches branch ON branch.id = invoice.branch_id
  ${condition([
    sql`(ledger.entry_type <> 'reversal' OR reversal.status = 'finalized')`,
    ...branchFilter(filters, 'invoice.branch_id'), ...timestampFilter(filters, 'ledger.created_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'line.employee_name_snapshot', 'line.item_name_snapshot',
    ]),
  ])}
`;

const adjustmentFacts = (filters: ReportFilters, kind: 'discount' | 'tax') => {
  const amount = kind === 'discount' ? 'discount_amount' : 'tax_amount';
  const adjustmentKind = kind === 'discount' ? 'discount_kind' : 'tax_kind';
  const adjustmentValue = kind === 'discount' ? 'discount_value' : 'tax_value';
  return sql`
    SELECT CONCAT('sale-', invoice.id) id, invoice.sold_at eventDate, branch.name branchName,
      invoice.invoice_number invoiceNumber, 'sale' eventType,
      ${sql.raw(`invoice.${adjustmentKind}`)} adjustmentKind,
      ${sql.raw(`invoice.${adjustmentValue}`)} adjustmentValue,
      ${sql.raw(`invoice.${amount}`)} amount
    FROM erp_invoices invoice
    INNER JOIN branches branch ON branch.id = invoice.branch_id
    ${condition([
      sql`invoice.status <> 'draft'`, sql`${sql.raw(`invoice.${amount}`)} > 0`,
      ...branchFilter(filters, 'invoice.branch_id'), ...timestampFilter(filters, 'invoice.sold_at'),
      ...searchFilter(filters, ['invoice.invoice_number']),
    ])}
    UNION ALL
    SELECT CONCAT(reversal.type, '-', reversal.id) id, reversal.created_at eventDate,
      branch.name branchName, invoice.invoice_number invoiceNumber, reversal.type eventType,
      ${sql.raw(`invoice.${adjustmentKind}`)} adjustmentKind,
      ${sql.raw(`invoice.${adjustmentValue}`)} adjustmentValue,
      -${sql.raw(`reversal.${amount}`)} amount
    FROM erp_invoice_reversals reversal
    INNER JOIN erp_invoices invoice
      ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
    INNER JOIN branches branch ON branch.id = reversal.branch_id
    ${condition([
      sql`reversal.status = 'finalized'`, sql`${sql.raw(`reversal.${amount}`)} > 0`,
      ...branchFilter(filters, 'reversal.branch_id'), ...timestampFilter(filters, 'reversal.created_at'),
      ...searchFilter(filters, ['invoice.invoice_number']),
    ])}
  `;
};

const reversalFacts = (filters: ReportFilters, type: 'refund' | 'void') => sql`
  SELECT reversal.id id, reversal.created_at eventDate, branch.name branchName,
    invoice.invoice_number invoiceNumber, invoice.client_name_snapshot clientName,
    reversal.reason reason, account.username authorizedBy, reversal.total amount
  FROM erp_invoice_reversals reversal
  INNER JOIN erp_invoices invoice
    ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
  INNER JOIN branches branch ON branch.id = reversal.branch_id
  INNER JOIN accounts account ON account.id = reversal.acting_account_id
  ${condition([
    sql`reversal.status = 'finalized'`, sql`reversal.type = ${type}`,
    ...branchFilter(filters, 'reversal.branch_id'), ...timestampFilter(filters, 'reversal.created_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'invoice.client_name_snapshot', 'reversal.reason', 'account.username',
    ]),
  ])}
`;

const expenseFacts = (filters: ReportFilters) => sql`
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

const purchaseFacts = (filters: ReportFilters) => sql`
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

const stockProductName = () => sql`COALESCE(
  CASE WHEN movement.source_type = 'sale' THEN (
    SELECT line.item_name_snapshot FROM erp_invoice_lines line
    WHERE line.invoice_id = movement.source_id AND line.branch_id = movement.branch_id
      AND line.product_id = movement.product_id LIMIT 1
  ) END,
  CASE WHEN movement.source_type IN ('refund', 'void') THEN (
    SELECT line.item_name_snapshot
    FROM erp_invoice_reversal_lines reversal_line
    INNER JOIN erp_invoice_reversals reversal
      ON reversal.id = reversal_line.reversal_id AND reversal.branch_id = reversal_line.branch_id
    INNER JOIN erp_invoice_lines line
      ON line.id = reversal_line.invoice_line_id AND line.branch_id = reversal_line.branch_id
    WHERE reversal.id = movement.source_id AND reversal.branch_id = movement.branch_id
      AND line.product_id = movement.product_id LIMIT 1
  ) END,
  CASE WHEN movement.source_type IN ('purchase', 'purchase_cancellation') THEN (
    SELECT line.product_name_snapshot FROM erp_purchase_lines line
    WHERE line.purchase_id = movement.source_id AND line.branch_id = movement.branch_id
      AND line.product_id = movement.product_id LIMIT 1
  ) END,
  product.name
)`;

const stockFacts = (filters: ReportFilters) => sql`
  SELECT movement.id id, movement.created_at eventDate, branch.name branchName,
    ${stockProductName()} productName,
    movement.reason reason, movement.quantity_delta quantityDelta,
    movement.balance_after balanceAfter, account.username authorizedBy, movement.note note
  FROM erp_stock_movements movement
  INNER JOIN erp_products product
    ON product.id = movement.product_id AND product.branch_id = movement.branch_id
  INNER JOIN branches branch ON branch.id = movement.branch_id
  INNER JOIN accounts account ON account.id = movement.acting_account_id
  ${condition([
    ...branchFilter(filters, 'movement.branch_id'), ...timestampFilter(filters, 'movement.created_at'),
    ...(filters.search ? [sql`(
      LOCATE(${filters.search}, ${stockProductName()}) > 0
      OR LOCATE(${filters.search}, movement.note) > 0
      OR LOCATE(${filters.search}, account.username) > 0
    )`] : []),
  ])}
`;

const profitFacts = (filters: ReportFilters) => saleLineEvents(filters, 'product', (args) => sql`
  SELECT ${args.id} id, ${args.eventDate} eventDate, ${sql.raw(args.branch)}.name branchName,
    ${sql.raw(args.invoice)}.invoice_number invoiceNumber,
    ${sql.raw(args.line)}.item_name_snapshot productName, ${args.eventType} eventType,
    ${args.quantity} quantity, ${args.amount} revenue,
    ${args.quantity} * ${sql.raw(args.line)}.product_cost_basis_snapshot cost,
    ${args.amount} - (${args.quantity} * ${sql.raw(args.line)}.product_cost_basis_snapshot) profit
`);

const clientFacts = (filters: ReportFilters) => sql`
  SELECT CONCAT('sale-', invoice.id) id, invoice.sold_at eventDate, branch.name branchName,
    invoice.invoice_number invoiceNumber, invoice.client_name_snapshot clientName,
    invoice.client_phone_snapshot clientPhone, 'sale' eventType,
    ${invoiceEmployeeList('invoice', 'name')} employeeName, invoice.total amount
  FROM erp_invoices invoice
  INNER JOIN branches branch ON branch.id = invoice.branch_id
  ${condition([
    sql`invoice.status <> 'draft'`, sql`invoice.kind = 'sale'`, ...branchFilter(filters, 'invoice.branch_id'),
    ...timestampFilter(filters, 'invoice.sold_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'invoice.client_name_snapshot', 'invoice.client_phone_snapshot',
    ]),
  ])}
  UNION ALL
  SELECT CONCAT(reversal.type, '-', reversal.id) id, reversal.created_at eventDate,
    branch.name branchName, invoice.invoice_number invoiceNumber,
    invoice.client_name_snapshot clientName, invoice.client_phone_snapshot clientPhone,
    reversal.type eventType, ${invoiceEmployeeList('invoice', 'name')} employeeName,
    -reversal.total amount
  FROM erp_invoice_reversals reversal
  INNER JOIN erp_invoices invoice
    ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
  INNER JOIN branches branch ON branch.id = reversal.branch_id
  ${condition([
    sql`reversal.status = 'finalized'`, ...branchFilter(filters, 'reversal.branch_id'),
    ...timestampFilter(filters, 'reversal.created_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'invoice.client_name_snapshot', 'invoice.client_phone_snapshot',
    ]),
  ])}
`;

const receivableFacts = (filters: ReportFilters) => sql`
  SELECT invoice.id id, invoice.sold_at eventDate, invoice.sold_at soldAt, branch.name branchName,
    invoice.invoice_number invoiceNumber, invoice.client_name_snapshot clientName,
    invoice.client_phone_snapshot clientPhone, invoice.total originalTotal,
    invoice.amount_paid amountPaid, invoice.credited_amount creditedAmount,
    invoice.balance_due balanceDue, DATEDIFF(CURRENT_DATE, DATE(invoice.sold_at)) ageDays
  FROM erp_invoices invoice
  INNER JOIN branches branch ON branch.id = invoice.branch_id
  ${condition([
    sql`invoice.kind = 'sale'`, sql`invoice.status <> 'draft'`, sql`invoice.balance_due > 0`,
    ...branchFilter(filters, 'invoice.branch_id'), ...timestampFilter(filters, 'invoice.sold_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'invoice.client_name_snapshot', 'invoice.client_phone_snapshot',
    ]),
  ])}
`;

const serviceQueueFacts = (filters: ReportFilters) => sql`
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

const serviceCompletionFacts = (filters: ReportFilters) => sql`
  SELECT report.id id, report.created_at eventDate, branch.name branchName,
    queue.cashier_session_id shiftId, line.item_name_snapshot serviceName,
    queue.queue_number queueNumber, invoice.invoice_number invoiceNumber,
    invoice.client_name_snapshot clientName, ${sql.raw(currentQueueEmployeeName)} employeeName,
    report.completion_kind completionKind,
    COALESCE(GROUP_CONCAT(CONCAT(product.name, ' ', consumption_usage.quantity, ' ', consumption_usage.unit)
      ORDER BY product.name SEPARATOR '، '), '') consumables,
    COALESCE(SUM(consumption_usage.total_cost), 0) totalCost
  FROM erp_service_consumption_reports report
  INNER JOIN erp_service_queue_entries queue ON queue.id = report.service_queue_entry_id
  INNER JOIN erp_invoices invoice ON invoice.id = queue.invoice_id AND invoice.branch_id = queue.branch_id
  INNER JOIN erp_invoice_lines line ON line.id = queue.invoice_line_id AND line.invoice_id = queue.invoice_id
  INNER JOIN branches branch ON branch.id = queue.branch_id
  LEFT JOIN erp_service_consumption_usages consumption_usage ON consumption_usage.report_id = report.id
  LEFT JOIN erp_products product ON product.id = consumption_usage.product_id
  ${condition([
    sql`report.is_current = true`, ...branchFilter(filters, 'queue.branch_id'),
    ...timestampFilter(filters, 'report.created_at'),
    ...searchFilter(filters, ['invoice.invoice_number', 'invoice.client_name_snapshot', 'line.item_name_snapshot', currentQueueEmployeeName, 'product.name']),
  ])}
  GROUP BY report.id, report.created_at, branch.name, queue.cashier_session_id,
    line.item_name_snapshot, queue.queue_number, invoice.invoice_number,
    invoice.client_name_snapshot, employeeName, report.completion_kind
`;

const consumableUsageFacts = (filters: ReportFilters) => sql`
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

const consumableLedgerFacts = (filters: ReportFilters) => sql`
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

const serviceExceptionFacts = (filters: ReportFilters) => sql`
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

const invoiceFacts = (filters: ReportFilters, selection: ReportSelection) => {
  const invoiceId = selection.mode === 'selected' && selection.ids.length === 1
    ? selection.ids[0]
    : 0;
  return sql`
    SELECT line.id id, line.line_number lineNumber, line.item_name_snapshot itemName,
      line.item_type itemType, line.quantity quantity, line.unit_price unitPrice,
      line.line_total lineTotal
    FROM erp_invoice_lines line
    INNER JOIN erp_invoices invoice
      ON invoice.id = line.invoice_id AND invoice.branch_id = line.branch_id
    ${condition([
      sql`invoice.id = ${invoiceId}`, sql`invoice.status <> 'draft'`,
      ...branchFilter(filters, 'invoice.branch_id'),
    ])}
  `;
};

const factsFor = (
  reportType: ErpReportType,
  filters: ReportFilters,
  selection: ReportSelection,
): SQL => {
  switch (reportType) {
    case 'erp-sales': return salesFacts(filters);
    case 'erp-payment-methods': return paymentFacts(filters);
    case 'erp-services': return serviceFacts(filters);
    case 'erp-products': return productFacts(filters);
    case 'erp-employees': return employeeFacts(filters);
    case 'erp-commissions': return commissionFacts(filters);
    case 'erp-discounts': return adjustmentFacts(filters, 'discount');
    case 'erp-taxes': return adjustmentFacts(filters, 'tax');
    case 'erp-refunds': return reversalFacts(filters, 'refund');
    case 'erp-voids': return reversalFacts(filters, 'void');
    case 'erp-expenses': return expenseFacts(filters);
    case 'erp-purchases': return purchaseFacts(filters);
    case 'erp-stock': return stockFacts(filters);
    case 'erp-profit': return profitFacts(filters);
    case 'erp-client-history': return clientFacts(filters);
    case 'erp-receivables': return receivableFacts(filters);
    case 'erp-service-queue': return serviceQueueFacts(filters);
    case 'erp-service-completions': return serviceCompletionFacts(filters);
    case 'erp-consumable-usage': return consumableUsageFacts(filters);
    case 'erp-consumable-ledger': return consumableLedgerFacts(filters);
    case 'erp-service-exceptions': return serviceExceptionFacts(filters);
    case 'erp-invoice': return invoiceFacts(filters, selection);
  }
};

const sum = (column: string, alias: string) => sql.raw(
  `COALESCE(SUM(${column}), 0) \`${alias}\``,
);

const summaryProjection = (reportType: ErpReportType): SQL => {
  switch (reportType) {
    case 'erp-sales': return sql`COUNT(*) totalRecords, ${sum('total', 'totalSales')}, ${sum('discountAmount', 'totalDiscount')}, ${sum('taxAmount', 'totalTax')}`;
    case 'erp-services':
    case 'erp-products': return sql`COUNT(*) totalRecords, ${sum('quantity', 'totalQuantity')}, ${sum('amount', 'totalRevenue')}`;
    case 'erp-payment-methods': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalNetPayments')}`;
    case 'erp-employees': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalNetSales')}`;
    case 'erp-commissions': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalCommission')}`;
    case 'erp-discounts': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalDiscount')}`;
    case 'erp-taxes': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalTax')}`;
    case 'erp-refunds': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalRefunds')}`;
    case 'erp-voids': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalVoids')}`;
    case 'erp-expenses': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalNetExpenses')}`;
    case 'erp-purchases': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalNetPurchases')}`;
    case 'erp-stock': return sql`COUNT(*) totalRecords, ${sum('quantityDelta', 'netQuantityChange')}`;
    case 'erp-profit': return sql`COUNT(*) totalRecords, ${sum('revenue', 'totalRevenue')}, ${sum('cost', 'totalCost')}, ${sum('profit', 'totalProfit')}`;
    case 'erp-client-history': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalNetSales')}`;
    case 'erp-receivables': return sql`COUNT(*) totalRecords, ${sum('balanceDue', 'totalBalanceDue')}`;
    case 'erp-service-queue': return sql`COUNT(*) totalRecords`;
    case 'erp-service-completions': return sql`COUNT(*) totalRecords, ${sum('totalCost', 'totalCost')}`;
    case 'erp-consumable-usage': return sql`COUNT(*) totalRecords, ${sum('quantity', 'totalQuantity')}, ${sum('cost', 'totalCost')}`;
    case 'erp-consumable-ledger': return sql`COUNT(*) totalRecords, ${sum('quantityDelta', 'netQuantityChange')}, ${sum('totalCost', 'totalCost')}`;
    case 'erp-service-exceptions': return sql`COUNT(*) totalRecords`;
    case 'erp-invoice': return sql`COUNT(*) totalRecords, ${sum('lineTotal', 'lineSubtotal')}`;
  }
};

const moneySummaryKeys = new Set([
  'totalSales', 'totalDiscount', 'totalTax', 'totalRevenue', 'totalNetPayments',
  'totalNetSales', 'totalCommission', 'totalRefunds', 'totalVoids',
  'totalNetExpenses', 'totalNetPurchases', 'totalCost', 'totalProfit', 'lineSubtotal',
  'totalBalanceDue',
]);

const normalizeCell = (value: unknown): ReportCell => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER)
    && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  return JSON.stringify(value) ?? '';
};

const eventLabels: Record<string, string> = {
  sale: 'بيع', refund: 'استرداد', void: 'إلغاء', earned: 'مستحقة', reversal: 'عكس',
  expense: 'مصروف', purchase: 'شراء', purchase_cancellation: 'إلغاء شراء',
};
const paymentLabels: Record<string, string> = {
  cash: 'نقدي', visa: 'فيزا', instapay: 'إنستا باي', vodafone_cash: 'فودافون كاش',
};
const stockReasonLabels: Record<string, string> = {
  opening_stock: 'رصيد افتتاحي', count_correction: 'تصحيح جرد', wastage: 'هالك',
  damage: 'تالف', sale: 'بيع', purchase: 'شراء', purchase_cancellation: 'إلغاء شراء',
  refund: 'استرداد', void: 'إلغاء',
};
const purchaseStatusLabels: Record<string, string> = {
  posted: 'مرحّلة', cancelled: 'ملغاة',
};

const currentQueueEmployeeName = `COALESCE((
  SELECT employee.full_name
  FROM erp_invoice_line_reassignments reassignment
  INNER JOIN employees employee ON employee.id = reassignment.to_employee_id
  WHERE reassignment.invoice_line_id = line.id
  ORDER BY reassignment.created_at DESC, reassignment.id DESC
  LIMIT 1
), line.employee_name_snapshot)`;
const serviceStatusLabels: Record<string, string> = {
  pending: 'قيد الانتظار', completed: 'مكتملة', overdue: 'متأخرة',
};
const completionKindLabels: Record<string, string> = {
  consumables: 'بمستهلكات', none: 'بدون مستهلكات',
};
const consumableEntryLabels: Record<string, string> = {
  reserve: 'تحويل إلى المستهلكات', return: 'إرجاع إلى مخزون البيع', consume: 'استهلاك خدمة',
  correction_restore: 'استرجاع تصحيح', correction_consume: 'استهلاك تصحيح',
};

export const localizeErpReportRow = (
  reportType: ErpReportType,
  row: RawRow,
): Record<string, ReportCell> => Object.fromEntries(
  Object.entries(row).map(([key, raw]) => {
    const value = normalizeCell(raw);
    if (key === 'eventType' && typeof value === 'string') return [key, eventLabels[value] ?? value];
    if (key === 'paymentMethod' && typeof value === 'string') return [key, paymentLabels[value] ?? value];
    if (key === 'adjustmentKind' && typeof value === 'string') {
      return [key, value === 'percentage' ? 'نسبة مئوية' : 'قيمة ثابتة'];
    }
    if (key === 'itemType' && typeof value === 'string') return [key, value === 'service' ? 'خدمة' : 'منتج'];
    if (reportType === 'erp-stock' && key === 'reason' && typeof value === 'string' && stockReasonLabels[value]) {
      return [key, stockReasonLabels[value]];
    }
    if (reportType === 'erp-purchases' && key === 'status' && typeof value === 'string') {
      return [key, purchaseStatusLabels[value] ?? value];
    }
    if ((reportType === 'erp-service-queue' || reportType === 'erp-service-completions'
      || reportType === 'erp-service-exceptions') && key === 'status' && typeof value === 'string') {
      return [key, serviceStatusLabels[value] ?? value];
    }
    if (reportType === 'erp-service-completions' && key === 'completionKind' && typeof value === 'string') {
      return [key, completionKindLabels[value] ?? value];
    }
    if (reportType === 'erp-consumable-ledger' && key === 'entryType' && typeof value === 'string') {
      return [key, consumableEntryLabels[value] ?? value];
    }
    return [key, value];
  }),
);

const invoiceSummary = async (
  transaction: Transaction,
  filters: ReportFilters,
  selection: ReportSelection,
  base: SQL,
) => {
  const invoiceId = selection.mode === 'selected' && selection.ids.length === 1
    ? selection.ids[0]
    : 0;
  const [header] = await rawRows<RawRow>(transaction.execute(sql`
    SELECT invoice.invoice_number invoiceNumber, invoice.sold_at businessDate,
      invoice.sold_at soldAt, branch.name branchName,
      invoice.client_name_snapshot clientName, invoice.client_phone_snapshot clientPhone,
      ${invoiceEmployeeList('invoice', 'name')} employeeName,
      ${invoiceEmployeeList('invoice', 'code')} employeeCode,
      invoice.authorized_by_snapshot authorizedBy, invoice.subtotal subtotal,
      invoice.discount_amount discountAmount, invoice.tax_amount taxAmount, invoice.total total,
      GROUP_CONCAT(CONCAT(payment.method, ': ', payment.amount)
        ORDER BY payment.id SEPARATOR ' | ') payments
    FROM erp_invoices invoice
    INNER JOIN branches branch ON branch.id = invoice.branch_id
    INNER JOIN erp_invoice_payments payment ON payment.invoice_id = invoice.id
    ${condition([
      sql`invoice.id = ${invoiceId}`, sql`invoice.status <> 'draft'`,
      ...branchFilter(filters, 'invoice.branch_id'),
    ])}
    GROUP BY invoice.id, branch.id
  `));
  const [count] = await rawRows<RawRow>(transaction.execute(sql`
    SELECT ${summaryProjection('erp-invoice')} FROM (${base}) facts
  `));
  return localizeErpReportRow('erp-invoice', {
    ...(header ?? {}), ...(count ?? { totalRecords: 0, lineSubtotal: '0.00' }),
  });
};

const normalizedSummary = async (
  transaction: Transaction,
  reportType: ErpReportType,
  filters: ReportFilters,
  selection: ReportSelection,
  base: SQL,
) => {
  const summary = reportType === 'erp-invoice'
    ? await invoiceSummary(transaction, filters, selection, base)
    : localizeErpReportRow(reportType, (await rawRows<RawRow>(transaction.execute(sql`
      SELECT ${summaryProjection(reportType)} FROM (${base}) facts
    `)))[0] ?? { totalRecords: 0 });
  return Object.fromEntries(Object.entries(summary).map(([key, value]) => [
    key,
    moneySummaryKeys.has(key) && typeof value === 'number' ? value.toFixed(2) : value,
  ]));
};

const reportRows = async (
  transaction: Transaction,
  reportType: ErpReportType,
  base: SQL,
  pagination: ErpReportPagination,
) => {
  const order = reportType === 'erp-invoice'
    ? sql` ORDER BY lineNumber ASC, id ASC`
    : sql` ORDER BY eventDate DESC, id DESC`;
  const limit = pagination
    ? sql` LIMIT ${pagination.pageSize} OFFSET ${(pagination.page - 1) * pagination.pageSize}`
    : sql``;
  return (await rawRows<RawRow>(transaction.execute(sql`
    SELECT * FROM (${base}) facts ${order} ${limit}
  `))).map((row) => localizeErpReportRow(reportType, row));
};

export const createDrizzleErpReportRepository = (database: Database): ErpReportRepository => ({
  readPage(reportType, filters, selection, pagination) {
    return database.transaction(async (transaction): Promise<ErpReportPage> => {
      const base = factsFor(reportType, filters, selection);
      const summary = await normalizedSummary(transaction, reportType, filters, selection, base);
      return {
        rows: await reportRows(transaction, reportType, base, pagination),
        total: Number(summary.totalRecords ?? 0),
        summary,
      };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  },
  readBatches(reportType, filters, selection, batchSize, onBatch) {
    return database.transaction(async (transaction) => {
      const base = factsFor(reportType, filters, selection);
      const summary = await normalizedSummary(transaction, reportType, filters, selection, base);
      const total = Number(summary.totalRecords ?? 0);
      let page = 1;
      let rowCount = 0;
      while (rowCount < total) {
        const rows = await reportRows(transaction, reportType, base, { page, pageSize: batchSize });
        if (!rows.length) break;
        await onBatch(rows);
        rowCount += rows.length;
        if (rows.length < batchSize) break;
        page += 1;
      }
      return { total, rowCount, summary };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  },
});
