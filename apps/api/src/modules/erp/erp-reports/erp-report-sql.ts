import type { ReportFilters } from '@capella/contracts';
import type { createDatabase } from '@capella/database';
import { sql, type SQL } from 'drizzle-orm';

import { startOfCairoDate } from '../cairo-calendar.js';

export type Database = ReturnType<typeof createDatabase>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type RawRow = Record<string, unknown>;

export const rawRows = async <T>(query: ReturnType<Transaction['execute']>) => (
  (await query)[0] as unknown as T[]
);

export const nextDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};

export const condition = (parts: SQL[]) => parts.length
  ? sql` WHERE ${sql.join(parts, sql` AND `)}`
  : sql``;

export const branchFilter = (filters: ReportFilters, expression: string): SQL[] => (
  filters.branchId === undefined ? [] : [sql`${sql.raw(expression)} = ${filters.branchId}`]
);

export const dateFilter = (filters: ReportFilters, expression: string): SQL[] => [
  ...(filters.dateFrom ? [sql`${sql.raw(expression)} >= ${filters.dateFrom}`] : []),
  ...(filters.dateTo ? [sql`${sql.raw(expression)} <= ${filters.dateTo}`] : []),
];

export const timestampFilter = (filters: ReportFilters, expression: string): SQL[] => [
  ...(filters.dateFrom
    ? [sql`${sql.raw(expression)} >= ${startOfCairoDate(filters.dateFrom)}`]
    : []),
  ...(filters.dateTo
    ? [sql`${sql.raw(expression)} < ${startOfCairoDate(nextDate(filters.dateTo))}`]
    : []),
];

export const searchFilter = (filters: ReportFilters, expressions: string[]): SQL[] => {
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
export const invoiceLineShare = (lineAlias: string, invoiceAlias: string, amountColumn: string) => {
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

export const invoiceLineDiscount = (lineAlias: string, invoiceAlias: string) => (
  invoiceLineShare(lineAlias, invoiceAlias, 'discount_amount')
);

export const refundedQueueRank = sql`(SELECT COUNT(*)
  FROM erp_commission_ledger_entries prior_ledger
  INNER JOIN erp_service_queue_entries prior_queue
    ON prior_queue.id = prior_ledger.service_queue_entry_id
  WHERE prior_ledger.invoice_reversal_id = reversal.id
    AND prior_ledger.invoice_line_id = original_line.id
    AND prior_ledger.entry_type = 'reversal'
    AND prior_queue.queue_number <= queue.queue_number)`;
export const refundedQueueAmount = sql`ROUND(reversal_line.total * ${refundedQueueRank}
  / reversal_line.quantity, 2)
  - ROUND(reversal_line.total * (${refundedQueueRank} - 1)
  / reversal_line.quantity, 2)`;

/**
 * An invoice no longer names one employee: each service line names its own, so
 * invoice-level columns list every distinct name (or code) behind the sale.
 */
export const invoiceEmployeeList = (invoiceAlias: string, column: 'name' | 'code') => {
  const invoice = sql.raw(invoiceAlias);
  const field = sql.raw(column === 'name' ? 'full_name' : 'employee_code');
  return sql`(
    SELECT GROUP_CONCAT(DISTINCT assigned_employee.${field} ORDER BY assigned_employee.${field} SEPARATOR ' | ')
    FROM erp_service_queue_entries assigned_queue
    INNER JOIN employees assigned_employee ON assigned_employee.id = assigned_queue.employee_id
    WHERE assigned_queue.invoice_id = ${invoice}.id
      AND assigned_queue.branch_id = ${invoice}.branch_id
  )`;
};

export const saleLineEvents = (
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
    invoicePaid: SQL;
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
      ...(itemType === 'product' ? ['invoice.seller_name_snapshot'] : []),
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
      ...(itemType === 'product' ? ['invoice.seller_name_snapshot'] : []),
    ]),
  ];
  const lineAmount = sql`line.line_total - (${invoiceLineDiscount('line', 'invoice')})`;
  return sql`
    ${projection({
      line: 'line', invoice: 'invoice', branch: 'branch', amount: lineAmount,
      quantity: sql`line.quantity`, eventType: sql`'sale'`, eventDate: sql`invoice.sold_at`,
      id: sql`CONCAT('sale-', line.id)`,
      invoicePaid: invoiceLineShare('line', 'invoice', 'amount_paid'),
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
      invoicePaid: sql`-ROUND((${invoiceLineShare('original_line', 'invoice', 'amount_paid')})
        * reversal_line.quantity / original_line.quantity, 2)`,
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
export const currentQueueEmployeeName = `(SELECT employee.full_name
  FROM employees employee WHERE employee.id = queue.employee_id)`;
