import type { ReportFilters, ReportSelection } from '@capella/contracts';
import { sql, type SQL } from 'drizzle-orm';

import {
  branchFilter,
  condition,
  invoiceEmployeeList,
  invoiceLineDiscount,
  invoiceLineShare,
  refundedQueueAmount,
  refundedQueueRank,
  saleLineEvents,
  searchFilter,
  timestampFilter,
} from './erp-report-sql.js';

export const salesFacts = (filters: ReportFilters) => sql`
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

export const paymentFacts = (filters: ReportFilters) => sql`
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

export const serviceFacts = (filters: ReportFilters) => {
  const queueRank = sql`(SELECT COUNT(*) FROM erp_service_queue_entries prefix
    WHERE prefix.invoice_line_id = line.id AND prefix.queue_number <= queue.queue_number)`;
  const lineNet = sql`line.line_total - (${invoiceLineDiscount('line', 'invoice')})`;
  const unitSaleAmount = sql`ROUND((${lineNet}) * ${queueRank} / line.quantity, 2)
    - ROUND((${lineNet}) * (${queueRank} - 1) / line.quantity, 2)`;
  const unitPaid = sql`ROUND(invoice.amount_paid * ${queueRank} / line.quantity, 2)
    - ROUND(invoice.amount_paid * (${queueRank} - 1) / line.quantity, 2)`;
  const originalQueueRank = sql`(SELECT COUNT(*) FROM erp_service_queue_entries prefix
    WHERE prefix.invoice_line_id = original_line.id AND prefix.queue_number <= queue.queue_number)`;
  const unitReversalPaid = sql`ROUND(invoice.amount_paid * ${originalQueueRank}
    / original_line.quantity, 2)
    - ROUND(invoice.amount_paid * (${originalQueueRank} - 1)
    / original_line.quantity, 2)`;
  const reversalNet = sql`reversal_line.gross_amount - reversal_line.discount_amount`;
  const unitReversalAmount = sql`ROUND((${reversalNet}) * ${refundedQueueRank}
    / reversal_line.quantity, 2)
    - ROUND((${reversalNet}) * (${refundedQueueRank} - 1)
    / reversal_line.quantity, 2)`;
  return sql`
    SELECT IF(line.quantity = 1, CONCAT('sale-', line.id),
      CONCAT('sale-', line.id, '-', queue.id)) id,
      invoice.sold_at eventDate, branch.name branchName,
      invoice.invoice_number invoiceNumber, line.item_name_snapshot serviceName,
      employee.full_name employeeName, 'individual' rowType, 'sale' eventType,
      1 quantity, line.unit_price unitPrice, ${unitSaleAmount} amount,
      ${unitPaid} invoicePaid
    FROM erp_service_queue_entries queue
    INNER JOIN erp_invoice_lines line ON line.id = queue.invoice_line_id
      AND line.invoice_id = queue.invoice_id AND line.branch_id = queue.branch_id
    INNER JOIN erp_invoices invoice
      ON invoice.id = line.invoice_id AND invoice.branch_id = line.branch_id
    INNER JOIN employees employee ON employee.id = queue.employee_id
    INNER JOIN branches branch ON branch.id = invoice.branch_id
    ${condition([
      sql`invoice.status <> 'draft'`, sql`invoice.kind = 'sale'`,
      ...branchFilter(filters, 'invoice.branch_id'),
      ...timestampFilter(filters, 'invoice.sold_at'),
      ...searchFilter(filters, [
        'line.item_name_snapshot', 'invoice.invoice_number',
        'invoice.client_name_snapshot', 'employee.full_name',
      ]),
    ])}
    UNION ALL
    SELECT CONCAT(reversal.type, '-', reversal_line.id, '-', queue.id) id,
      reversal.created_at eventDate, branch.name branchName,
      invoice.invoice_number invoiceNumber, original_line.item_name_snapshot serviceName,
      employee.full_name employeeName, 'individual' rowType, reversal.type eventType,
      -1 quantity, original_line.unit_price unitPrice,
      -(${unitReversalAmount}) amount,
      -(${unitReversalPaid}) invoicePaid
    FROM erp_invoice_reversal_lines reversal_line
    INNER JOIN erp_invoice_reversals reversal ON reversal.id = reversal_line.reversal_id
      AND reversal.invoice_id = reversal_line.invoice_id
      AND reversal.branch_id = reversal_line.branch_id
    INNER JOIN erp_invoice_lines original_line ON original_line.id = reversal_line.invoice_line_id
      AND original_line.invoice_id = reversal_line.invoice_id
      AND original_line.branch_id = reversal_line.branch_id
    INNER JOIN erp_commission_ledger_entries ledger
      ON ledger.invoice_reversal_id = reversal.id
      AND ledger.invoice_line_id = original_line.id
      AND ledger.entry_type = 'reversal' AND ledger.service_queue_entry_id IS NOT NULL
    INNER JOIN erp_service_queue_entries queue ON queue.id = ledger.service_queue_entry_id
    INNER JOIN employees employee ON employee.id = ledger.employee_id
    INNER JOIN erp_invoices invoice
      ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
    INNER JOIN branches branch ON branch.id = reversal.branch_id
    ${condition([
      sql`reversal.status = 'finalized'`, sql`original_line.item_type = 'service'`,
      ...branchFilter(filters, 'reversal.branch_id'),
      ...timestampFilter(filters, 'reversal.created_at'),
      ...searchFilter(filters, [
        'original_line.item_name_snapshot', 'invoice.invoice_number',
        'invoice.client_name_snapshot', 'employee.full_name',
      ]),
    ])}
    UNION ALL
    SELECT CONCAT(reversal.type, '-', reversal_line.id) id,
      reversal.created_at eventDate, branch.name branchName,
      invoice.invoice_number invoiceNumber, original_line.item_name_snapshot serviceName,
      original_line.employee_name_snapshot employeeName, 'individual' rowType,
      reversal.type eventType, -reversal_line.quantity quantity,
      original_line.unit_price unitPrice,
      -(reversal_line.gross_amount - reversal_line.discount_amount) amount,
      -ROUND(invoice.amount_paid * reversal_line.quantity / original_line.quantity, 2) invoicePaid
    FROM erp_invoice_reversal_lines reversal_line
    INNER JOIN erp_invoice_reversals reversal ON reversal.id = reversal_line.reversal_id
      AND reversal.invoice_id = reversal_line.invoice_id
      AND reversal.branch_id = reversal_line.branch_id
    INNER JOIN erp_invoice_lines original_line ON original_line.id = reversal_line.invoice_line_id
      AND original_line.invoice_id = reversal_line.invoice_id
      AND original_line.branch_id = reversal_line.branch_id
    INNER JOIN erp_invoices invoice
      ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
    INNER JOIN branches branch ON branch.id = reversal.branch_id
    ${condition([
      sql`reversal.status = 'finalized'`, sql`original_line.item_type = 'service'`,
      sql`NOT EXISTS (SELECT 1 FROM erp_commission_ledger_entries mapped
        WHERE mapped.invoice_reversal_id = reversal.id
          AND mapped.invoice_line_id = original_line.id
          AND mapped.entry_type = 'reversal'
          AND mapped.service_queue_entry_id IS NOT NULL)`,
      ...branchFilter(filters, 'reversal.branch_id'),
      ...timestampFilter(filters, 'reversal.created_at'),
      ...searchFilter(filters, [
        'original_line.item_name_snapshot', 'invoice.invoice_number',
        'invoice.client_name_snapshot', 'original_line.employee_name_snapshot',
      ]),
    ])}
  `;
};

export const productFacts = (filters: ReportFilters) => saleLineEvents(filters, 'product', (args) => sql`
  SELECT ${args.id} id, ${args.eventDate} eventDate, ${sql.raw(args.branch)}.name branchName,
    ${sql.raw(args.invoice)}.invoice_number invoiceNumber,
    ${sql.raw(args.invoice)}.seller_name_snapshot employeeName,
    ${sql.raw(args.line)}.item_name_snapshot productName, 'individual' rowType,
    ${args.eventType} eventType,
    ${args.quantity} quantity, ${sql.raw(args.line)}.unit_price unitPrice,
    ${sql.raw(args.line)}.product_cost_basis_snapshot costBasis, ${args.amount} amount,
    ${args.invoicePaid} invoicePaid
`);

export const withCombinedRows = (
  facts: SQL,
  nameColumn: 'serviceName' | 'productName',
): SQL => {
  const employeeCounts = nameColumn === 'serviceName'
    ? sql`
      SELECT serviceName,
        SUBSTRING_INDEX(GROUP_CONCAT(employeeName ORDER BY employeeCount DESC, employeeName), ',', 1) employeeName
      FROM (
        SELECT serviceName, employeeName, COUNT(*) employeeCount
        FROM (${facts}) AS employee_facts
        WHERE employeeName IS NOT NULL
        GROUP BY serviceName, employeeName
      ) AS counted_employees
      GROUP BY serviceName
    `
    : sql`
      SELECT productName,
        SUBSTRING_INDEX(GROUP_CONCAT(employeeName ORDER BY employeeCount DESC, employeeName), ',', 1) employeeName
      FROM (
        SELECT productName, employeeName, COUNT(*) employeeCount
        FROM (${facts}) AS employee_facts
        WHERE employeeName IS NOT NULL
        GROUP BY productName, employeeName
      ) AS counted_employees
      GROUP BY productName
    `;
  const combined = nameColumn === 'serviceName'
    ? sql`
      SELECT CONCAT('combined:', combined_facts.serviceName) id, NULL eventDate, NULL branchName,
        NULL invoiceNumber, combined_facts.serviceName, employee_counts.employeeName,
        'combined' rowType, 'مجمع' eventType, SUM(combined_facts.quantity) quantity,
        NULL unitPrice, SUM(combined_facts.amount) amount, SUM(combined_facts.invoicePaid) invoicePaid
      FROM (${facts}) AS combined_facts
      LEFT JOIN (${employeeCounts}) AS employee_counts
        ON employee_counts.serviceName = combined_facts.serviceName
      GROUP BY combined_facts.serviceName, employee_counts.employeeName
    `
    : sql`
      SELECT CONCAT('combined:', combined_facts.productName) id, NULL eventDate, NULL branchName,
        NULL invoiceNumber, employee_counts.employeeName, combined_facts.productName,
        'combined' rowType, 'مجمع' eventType, SUM(combined_facts.quantity) quantity,
        NULL unitPrice, NULL costBasis, SUM(combined_facts.amount) amount,
        SUM(combined_facts.invoicePaid) invoicePaid
      FROM (${facts}) AS combined_facts
      LEFT JOIN (${employeeCounts}) AS employee_counts
        ON employee_counts.productName = combined_facts.productName
      GROUP BY combined_facts.productName, employee_counts.employeeName
    `;
  return sql`SELECT * FROM (${facts}) AS individual_facts UNION ALL ${combined}`;
};

/**
 * Services belong to their assigned employee. Products belong to the invoice's
 * seller/cashier. Both streams retain their own quantities and net values so a
 * combined employee row never hides how its total was earned.
 */
const employeeEventFacts = (filters: ReportFilters) => sql`
  SELECT CONCAT('sale-', invoice.id, '-', queue.employee_id) id, invoice.sold_at eventDate,
    branch.name branchName, invoice.invoice_number invoiceNumber,
    queue.employee_id employeeId,
    employee.employee_code employeeCode, employee.full_name employeeName,
    'service' activityType, COUNT(*) serviceQuantity,
    0 productQuantity,
    SUM(
      ROUND((line.line_total
        - (${invoiceLineShare('line', 'invoice', 'discount_amount')})
        + (${invoiceLineShare('line', 'invoice', 'tax_amount')})) *
        (SELECT COUNT(*) FROM erp_service_queue_entries prefix
          WHERE prefix.invoice_line_id = line.id AND prefix.queue_number <= queue.queue_number)
        / line.quantity, 2)
      - ROUND((line.line_total
        - (${invoiceLineShare('line', 'invoice', 'discount_amount')})
        + (${invoiceLineShare('line', 'invoice', 'tax_amount')})) *
        ((SELECT COUNT(*) FROM erp_service_queue_entries prefix
          WHERE prefix.invoice_line_id = line.id AND prefix.queue_number <= queue.queue_number) - 1)
        / line.quantity, 2)
    ) serviceAmount, 0 productAmount
  FROM erp_service_queue_entries queue
  INNER JOIN erp_invoice_lines line ON line.id = queue.invoice_line_id
    AND line.invoice_id = queue.invoice_id AND line.branch_id = queue.branch_id
  INNER JOIN erp_invoices invoice
    ON invoice.id = line.invoice_id AND invoice.branch_id = line.branch_id
  INNER JOIN employees employee ON employee.id = queue.employee_id
  INNER JOIN branches branch ON branch.id = invoice.branch_id
  ${condition([
    sql`invoice.status <> 'draft'`, sql`invoice.kind = 'sale'`,
    sql`line.item_type = 'service'`,
    ...branchFilter(filters, 'invoice.branch_id'),
    ...timestampFilter(filters, 'invoice.sold_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'employee.full_name',
      'CAST(employee.employee_code AS CHAR)',
    ]),
  ])}
  GROUP BY invoice.id, branch.name, invoice.invoice_number, invoice.sold_at,
    invoice.discount_amount, invoice.tax_amount, invoice.subtotal,
    queue.employee_id, employee.employee_code, employee.full_name
  UNION ALL
  SELECT CONCAT(reversal.type, '-', reversal.id, '-', ledger.employee_id) id,
    reversal.created_at eventDate, branch.name branchName, invoice.invoice_number invoiceNumber,
    ledger.employee_id employeeId, employee.employee_code employeeCode,
    employee.full_name employeeName, 'service' activityType,
    -COUNT(*) serviceQuantity, 0 productQuantity,
    -SUM(${refundedQueueAmount}) serviceAmount, 0 productAmount
  FROM erp_invoice_reversal_lines reversal_line
  INNER JOIN erp_invoice_reversals reversal
    ON reversal.id = reversal_line.reversal_id
    AND reversal.invoice_id = reversal_line.invoice_id
    AND reversal.branch_id = reversal_line.branch_id
  INNER JOIN erp_invoice_lines original_line
    ON original_line.id = reversal_line.invoice_line_id
    AND original_line.invoice_id = reversal_line.invoice_id
    AND original_line.branch_id = reversal_line.branch_id
  INNER JOIN erp_commission_ledger_entries ledger
    ON ledger.invoice_reversal_id = reversal.id
    AND ledger.invoice_line_id = original_line.id
    AND ledger.entry_type = 'reversal'
    AND ledger.service_queue_entry_id IS NOT NULL
  INNER JOIN erp_service_queue_entries queue ON queue.id = ledger.service_queue_entry_id
  INNER JOIN employees employee ON employee.id = ledger.employee_id
  INNER JOIN erp_invoices invoice
    ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
  INNER JOIN branches branch ON branch.id = reversal.branch_id
  ${condition([
    sql`reversal.status = 'finalized'`, sql`invoice.kind = 'sale'`,
    sql`original_line.item_type = 'service'`,
    ...branchFilter(filters, 'reversal.branch_id'),
    ...timestampFilter(filters, 'reversal.created_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'employee.full_name',
      'CAST(employee.employee_code AS CHAR)',
    ]),
  ])}
  GROUP BY reversal.id, reversal.type, reversal.created_at, branch.name, invoice.invoice_number,
    ledger.employee_id, employee.employee_code, employee.full_name
  UNION ALL
  SELECT CONCAT(reversal.type, '-', reversal.id, '-', original_line.employee_id) id,
    reversal.created_at eventDate, branch.name branchName, invoice.invoice_number invoiceNumber,
    original_line.employee_id employeeId,
    original_line.employee_code_snapshot employeeCode,
    original_line.employee_name_snapshot employeeName,
    'service' activityType, -SUM(reversal_line.quantity) serviceQuantity,
    0 productQuantity, -SUM(reversal_line.total) serviceAmount, 0 productAmount
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
    sql`reversal.status = 'finalized'`, sql`invoice.kind = 'sale'`,
    sql`original_line.item_type = 'service'`, sql`original_line.employee_id IS NOT NULL`,
    sql`NOT EXISTS (SELECT 1 FROM erp_commission_ledger_entries mapped
      WHERE mapped.invoice_reversal_id = reversal.id
        AND mapped.invoice_line_id = original_line.id
        AND mapped.entry_type = 'reversal'
        AND mapped.service_queue_entry_id IS NOT NULL)`,
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
  UNION ALL
  SELECT CONCAT('product-sale-', invoice.id) id, invoice.sold_at eventDate,
    branch.name branchName, invoice.invoice_number invoiceNumber,
    invoice.seller_employee_id employeeId, employee.employee_code employeeCode,
    invoice.seller_name_snapshot employeeName, 'product' activityType,
    0 serviceQuantity, SUM(line.quantity) productQuantity,
    0 serviceAmount,
    SUM(
      line.line_total
        - (${invoiceLineShare('line', 'invoice', 'discount_amount')})
        + (${invoiceLineShare('line', 'invoice', 'tax_amount')})
    ) productAmount
  FROM erp_invoice_lines line
  INNER JOIN erp_invoices invoice
    ON invoice.id = line.invoice_id AND invoice.branch_id = line.branch_id
  INNER JOIN employees employee ON employee.id = invoice.seller_employee_id
  INNER JOIN branches branch ON branch.id = invoice.branch_id
  ${condition([
    sql`invoice.status <> 'draft'`, sql`invoice.kind = 'sale'`,
    sql`line.item_type = 'product'`, sql`invoice.seller_employee_id IS NOT NULL`,
    ...branchFilter(filters, 'invoice.branch_id'),
    ...timestampFilter(filters, 'invoice.sold_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'invoice.seller_name_snapshot',
      'CAST(employee.employee_code AS CHAR)',
    ]),
  ])}
  GROUP BY invoice.id, branch.name, invoice.invoice_number, invoice.sold_at,
    invoice.discount_amount, invoice.tax_amount, invoice.subtotal,
    invoice.seller_employee_id, employee.employee_code, invoice.seller_name_snapshot
  UNION ALL
  SELECT CONCAT('product-', reversal.type, '-', reversal.id) id,
    reversal.created_at eventDate, branch.name branchName,
    invoice.invoice_number invoiceNumber, invoice.seller_employee_id employeeId,
    employee.employee_code employeeCode, invoice.seller_name_snapshot employeeName,
    'product' activityType, 0 serviceQuantity,
    -SUM(reversal_line.quantity) productQuantity, 0 serviceAmount,
    -SUM(reversal_line.total) productAmount
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
  INNER JOIN employees employee ON employee.id = invoice.seller_employee_id
  INNER JOIN branches branch ON branch.id = reversal.branch_id
  ${condition([
    sql`reversal.status = 'finalized'`, sql`invoice.kind = 'sale'`,
    sql`original_line.item_type = 'product'`, sql`invoice.seller_employee_id IS NOT NULL`,
    ...branchFilter(filters, 'reversal.branch_id'),
    ...timestampFilter(filters, 'reversal.created_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'invoice.seller_name_snapshot',
      'CAST(employee.employee_code AS CHAR)',
    ]),
  ])}
  GROUP BY reversal.id, reversal.type, reversal.created_at, branch.name,
    invoice.invoice_number, invoice.seller_employee_id, employee.employee_code,
    invoice.seller_name_snapshot
`;

export const commissionFacts = (filters: ReportFilters) => sql`
  SELECT ledger.employee_id id, MAX(employee.employee_code) employeeCode,
    MAX(employee.full_name) employeeName,
    CAST(ROUND(SUM(CASE WHEN line.item_type = 'service' THEN
      CASE WHEN ledger.entry_type IN ('earned', 'reassignment_in')
        THEN ledger.base_amount / line.unit_price
        ELSE -ledger.base_amount / line.unit_price END
      ELSE 0 END), 0) AS SIGNED) serviceCount,
    COALESCE(SUM(CASE WHEN ledger.entry_type IN ('earned', 'reassignment_in')
      THEN ledger.amount ELSE 0 END), 0) earnedAmount,
    COALESCE(-SUM(CASE WHEN ledger.entry_type IN ('reversal', 'reassignment_out')
      THEN ledger.amount ELSE 0 END), 0) reversedAmount,
    COALESCE(SUM(ledger.amount), 0) netAmount
  FROM erp_commission_ledger_entries ledger
  INNER JOIN erp_invoices invoice ON invoice.id = ledger.invoice_id
  INNER JOIN erp_invoice_lines line
    ON line.id = ledger.invoice_line_id AND line.invoice_id = ledger.invoice_id
      AND line.branch_id = invoice.branch_id
  INNER JOIN employees employee ON employee.id = ledger.employee_id
  LEFT JOIN erp_invoice_reversals reversal
    ON reversal.id = ledger.invoice_reversal_id
      AND reversal.invoice_id = ledger.invoice_id
      AND reversal.branch_id = invoice.branch_id
  INNER JOIN branches branch ON branch.id = invoice.branch_id
  ${condition([
    sql`(ledger.entry_type <> 'reversal' OR reversal.status = 'finalized')`,
    ...branchFilter(filters, 'invoice.branch_id'), ...timestampFilter(filters, 'ledger.created_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'employee.full_name', 'line.item_name_snapshot',
    ]),
  ])}
  GROUP BY ledger.employee_id
`;

export const adjustmentFacts = (filters: ReportFilters, kind: 'discount' | 'tax') => {
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

export const refundFacts = (filters: ReportFilters) => sql`
  SELECT reversal_line.id id, reversal.created_at eventDate, branch.name branchName,
    invoice.invoice_number invoiceNumber, invoice.client_name_snapshot clientName,
    original_line.item_name_snapshot itemName, original_line.item_type itemType,
    reversal_line.quantity quantity, original_line.employee_name_snapshot employeeName,
    reversal.reason reason, account.username authorizedBy, reversal_line.total amount
  FROM erp_invoice_reversals reversal
  INNER JOIN erp_invoice_reversal_lines reversal_line
    ON reversal_line.reversal_id = reversal.id
    AND reversal_line.invoice_id = reversal.invoice_id
    AND reversal_line.branch_id = reversal.branch_id
  INNER JOIN erp_invoice_lines original_line
    ON original_line.id = reversal_line.invoice_line_id
    AND original_line.invoice_id = reversal_line.invoice_id
    AND original_line.branch_id = reversal_line.branch_id
  INNER JOIN erp_invoices invoice
    ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
  INNER JOIN branches branch ON branch.id = reversal.branch_id
  INNER JOIN accounts account ON account.id = reversal.acting_account_id
  ${condition([
    sql`reversal.status = 'finalized'`, sql`reversal.type = 'refund'`,
    sql`(original_line.item_type <> 'service' OR NOT EXISTS (
      SELECT 1 FROM erp_commission_ledger_entries mapped
      WHERE mapped.invoice_reversal_id = reversal.id
        AND mapped.invoice_line_id = original_line.id
        AND mapped.entry_type = 'reversal'
        AND mapped.service_queue_entry_id IS NOT NULL))`,
    ...branchFilter(filters, 'reversal.branch_id'), ...timestampFilter(filters, 'reversal.created_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'invoice.client_name_snapshot', 'original_line.item_name_snapshot',
      'original_line.employee_name_snapshot', 'reversal.reason', 'account.username',
    ]),
  ])}
  UNION ALL
  SELECT CONCAT(reversal_line.id, '-', queue.id) id,
    reversal.created_at eventDate, branch.name branchName,
    invoice.invoice_number invoiceNumber, invoice.client_name_snapshot clientName,
    original_line.item_name_snapshot itemName, original_line.item_type itemType,
    1 quantity, employee.full_name employeeName,
    reversal.reason reason, account.username authorizedBy,
    ${refundedQueueAmount} amount
  FROM erp_invoice_reversals reversal
  INNER JOIN erp_invoice_reversal_lines reversal_line
    ON reversal_line.reversal_id = reversal.id
    AND reversal_line.invoice_id = reversal.invoice_id
    AND reversal_line.branch_id = reversal.branch_id
  INNER JOIN erp_invoice_lines original_line
    ON original_line.id = reversal_line.invoice_line_id
    AND original_line.invoice_id = reversal_line.invoice_id
    AND original_line.branch_id = reversal_line.branch_id
  INNER JOIN erp_commission_ledger_entries ledger
    ON ledger.invoice_reversal_id = reversal.id
    AND ledger.invoice_line_id = original_line.id
    AND ledger.entry_type = 'reversal'
    AND ledger.service_queue_entry_id IS NOT NULL
  INNER JOIN erp_service_queue_entries queue ON queue.id = ledger.service_queue_entry_id
  INNER JOIN employees employee ON employee.id = ledger.employee_id
  INNER JOIN erp_invoices invoice
    ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
  INNER JOIN branches branch ON branch.id = reversal.branch_id
  INNER JOIN accounts account ON account.id = reversal.acting_account_id
  ${condition([
    sql`reversal.status = 'finalized'`, sql`reversal.type = 'refund'`,
    sql`original_line.item_type = 'service'`,
    ...branchFilter(filters, 'reversal.branch_id'), ...timestampFilter(filters, 'reversal.created_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'invoice.client_name_snapshot', 'original_line.item_name_snapshot',
      'employee.full_name', 'reversal.reason', 'account.username',
    ]),
  ])}
`;
export const voidFacts = (filters: ReportFilters) => sql`
  SELECT reversal.id id, reversal.created_at eventDate, branch.name branchName,
    invoice.invoice_number invoiceNumber, invoice.client_name_snapshot clientName,
    reversal.reason reason, account.username authorizedBy, reversal.total amount
  FROM erp_invoice_reversals reversal
  INNER JOIN erp_invoices invoice
    ON invoice.id = reversal.invoice_id AND invoice.branch_id = reversal.branch_id
  INNER JOIN branches branch ON branch.id = reversal.branch_id
  INNER JOIN accounts account ON account.id = reversal.acting_account_id
  ${condition([
    sql`reversal.status = 'finalized'`, sql`reversal.type = 'void'`,
    ...branchFilter(filters, 'reversal.branch_id'), ...timestampFilter(filters, 'reversal.created_at'),
    ...searchFilter(filters, [
      'invoice.invoice_number', 'invoice.client_name_snapshot', 'reversal.reason', 'account.username',
    ]),
  ])}
`;

export const employeeFacts = (filters: ReportFilters) => sql`
  SELECT employeeId id, MAX(eventDate) eventDate, MAX(branchName) branchName,
    MAX(employeeCode) employeeCode, MAX(employeeName) employeeName,
    COUNT(DISTINCT invoiceNumber) invoiceCount,
    SUM(serviceQuantity) serviceQuantity, SUM(serviceAmount) serviceAmount,
    SUM(productQuantity) productQuantity, SUM(productAmount) productAmount,
    SUM(serviceAmount + productAmount) netAmount,
    SUM(serviceAmount + productAmount) amount
  FROM (${employeeEventFacts(filters)}) employee_events
  GROUP BY employeeId
`;
export const clientFacts = (filters: ReportFilters) => sql`
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

export const receivableFacts = (filters: ReportFilters) => sql`
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
export const invoiceFacts = (filters: ReportFilters, selection: ReportSelection) => {
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
