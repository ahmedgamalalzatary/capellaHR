import type { ReportFilters, ReportSelection } from '@capella/contracts';
import { sql, type SQL } from 'drizzle-orm';

import type {
  ErpReportPage,
  ErpReportPagination,
  ErpReportRepository,
  ErpReportType,
} from './erp-report-reader.js';
import { factsFor, summaryProjection, withCombinedRows } from './erp-report-facts.js';
export { localizeErpReportRow } from './erp-report-localization.js';
import { localizeErpReportRow } from './erp-report-localization.js';
import {
  branchFilter,
  condition,
  invoiceEmployeeList,
  rawRows,
  type Database,
  type RawRow,
  type Transaction,
} from './erp-report-sql.js';

const moneySummaryKeys = new Set([
  'totalSales', 'totalDiscount', 'totalTax', 'totalRevenue', 'totalNetPayments',
  'totalNetSales', 'totalServiceSales', 'totalProductSales',
  'totalCommission', 'totalRefunds', 'totalVoids',
  'totalNetExpenses', 'totalNetPurchases', 'totalCost', 'totalProfit', 'lineSubtotal',
  'totalBalanceDue', 'totalTransferCost',
  'totalNetCashPayments', 'totalNetVisaPayments', 'totalNetInstapayPayments',
  'totalNetVodafoneCashPayments',
  'totalInventoryValue',
]);

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
  const reportBase = reportType === 'erp-services'
    ? withCombinedRows(base, 'serviceName')
    : reportType === 'erp-products'
      ? withCombinedRows(base, 'productName')
      : base;
  const order = reportType === 'erp-invoice'
    ? sql` ORDER BY lineNumber ASC, id ASC`
    : reportType === 'erp-commissions'
      ? sql` ORDER BY employeeName ASC, id ASC`
      : reportType === 'erp-services'
        ? sql` ORDER BY serviceName ASC, rowType = 'combined' ASC, eventDate DESC, id ASC`
        : reportType === 'erp-products'
          ? sql` ORDER BY productName ASC, rowType = 'combined' ASC, eventDate DESC, id ASC`
          : sql` ORDER BY eventDate DESC, id DESC`;
  const limit = pagination
    ? sql` LIMIT ${pagination.pageSize} OFFSET ${(pagination.page - 1) * pagination.pageSize}`
    : sql``;
  return (await rawRows<RawRow>(transaction.execute(sql`
    SELECT * FROM (${reportBase}) facts ${order} ${limit}
  `))).map((row) => {
    const reportRow = { ...row };
    Reflect.deleteProperty(reportRow, 'rowType');
    return localizeErpReportRow(reportType, reportRow);
  });
};

const displayTotal = async (
  transaction: Transaction,
  reportType: ErpReportType,
  base: SQL,
  summaryTotal: number,
) => {
  if (reportType !== 'erp-services' && reportType !== 'erp-products') return summaryTotal;
  const nameColumn = reportType === 'erp-services' ? 'serviceName' : 'productName';
  const [row] = await rawRows<RawRow>(transaction.execute(sql`
    SELECT COUNT(DISTINCT ${sql.raw(nameColumn)}) count FROM (${base}) facts
  `));
  return summaryTotal + Number(row?.count ?? 0);
};

export const createDrizzleErpReportRepository = (database: Database): ErpReportRepository => ({
  readPage(reportType, filters, selection, pagination) {
    return database.transaction(async (transaction): Promise<ErpReportPage> => {
      const base = factsFor(reportType, filters, selection);
      const summary = await normalizedSummary(transaction, reportType, filters, selection, base);
      return {
        rows: await reportRows(transaction, reportType, base, pagination),
        total: await displayTotal(transaction, reportType, base, Number(summary.totalRecords ?? 0)),
        summary,
      };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  },
  readBatches(reportType, filters, selection, batchSize, onBatch) {
    return database.transaction(async (transaction) => {
      const base = factsFor(reportType, filters, selection);
      const summary = await normalizedSummary(transaction, reportType, filters, selection, base);
      const total = await displayTotal(transaction, reportType, base, Number(summary.totalRecords ?? 0));
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
