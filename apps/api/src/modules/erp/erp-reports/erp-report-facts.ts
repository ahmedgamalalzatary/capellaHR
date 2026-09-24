import type { ReportFilters, ReportSelection } from '@capella/contracts';
import { sql, type SQL } from 'drizzle-orm';

import type { ErpReportType } from './erp-report-reader.js';
import {
  consumableLedgerFacts,
  consumableUsageFacts,
  expenseFacts,
  profitFacts,
  purchaseFacts,
  serviceCompletionFacts,
  serviceExceptionFacts,
  serviceQueueFacts,
  stockFacts,
  transferFacts,
} from './erp-report-ops-facts.js';
import {
  adjustmentFacts,
  clientFacts,
  commissionFacts,
  employeeFacts,
  invoiceFacts,
  paymentFacts,
  productFacts,
  receivableFacts,
  refundFacts,
  salesFacts,
  serviceFacts,
  voidFacts,
} from './erp-report-sale-facts.js';

export { withCombinedRows } from './erp-report-sale-facts.js';

export const factsFor = (
  reportType: ErpReportType,
  filters: ReportFilters,
  selection: ReportSelection,
): SQL => {
  const facts = (() => {
    switch (reportType) {
    case 'erp-sales': return salesFacts(filters);
    case 'erp-payment-methods': return paymentFacts(filters);
    case 'erp-services': return serviceFacts(filters);
    case 'erp-products': return productFacts(filters);
    case 'erp-employees': return employeeFacts(filters);
    case 'erp-commissions': return commissionFacts(filters);
    case 'erp-discounts': return adjustmentFacts(filters, 'discount');
    case 'erp-refunds': return refundFacts(filters);
    case 'erp-voids': return voidFacts(filters);
    case 'erp-expenses': return expenseFacts(filters);
    case 'erp-purchases': return purchaseFacts(filters);
    case 'erp-transfers': return transferFacts(filters);
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
  })();
  if (selection.mode === 'all' || reportType === 'erp-invoice') return facts;
  return sql`SELECT * FROM (${facts}) selectable_facts
    WHERE CAST(selectable_facts.id AS CHAR) IN (${sql.join(
      selection.ids.map((id) => sql`${String(id)}`), sql`, `,
    )})`;
};

const sum = (column: string, alias: string) => sql.raw(
  `COALESCE(SUM(${column}), 0) \`${alias}\``,
);

export const summaryProjection = (reportType: ErpReportType): SQL => {
  switch (reportType) {
    case 'erp-sales': return sql`COUNT(*) totalRecords, ${sum('total', 'totalSales')}, ${sum('discountAmount', 'totalDiscount')}, ${sum('taxAmount', 'totalTax')}`;
    case 'erp-services': return sql`COUNT(*) totalRecords,
      COALESCE(SUM(CASE WHEN eventType = 'sale' THEN quantity ELSE 0 END), 0) totalMadeServices,
      COALESCE(-SUM(CASE WHEN eventType IN ('refund', 'void') THEN quantity ELSE 0 END), 0) totalRefundedServices,
      ${sum('quantity', 'totalQuantity')}, ${sum('amount', 'totalRevenue')}`;
    case 'erp-products': return sql`COUNT(*) totalRecords,
      COALESCE(SUM(CASE WHEN eventType = 'sale' THEN quantity ELSE 0 END), 0) totalSoldProducts,
      COALESCE(-SUM(CASE WHEN eventType IN ('refund', 'void') THEN quantity ELSE 0 END), 0) totalRefundedProducts,
      ${sum('quantity', 'totalQuantity')}, ${sum('amount', 'totalRevenue')}`;
    case 'erp-payment-methods': return sql`COUNT(*) totalRecords,
      ${sum('amount', 'totalNetPayments')},
      COALESCE(SUM(CASE WHEN paymentMethod = 'cash' THEN amount ELSE 0 END), 0) totalNetCashPayments,
      COALESCE(SUM(CASE WHEN paymentMethod = 'visa' THEN amount ELSE 0 END), 0) totalNetVisaPayments,
      COALESCE(SUM(CASE WHEN paymentMethod = 'instapay' THEN amount ELSE 0 END), 0) totalNetInstapayPayments,
      COALESCE(SUM(CASE WHEN paymentMethod = 'vodafone_cash' THEN amount ELSE 0 END), 0) totalNetVodafoneCashPayments`;
    case 'erp-employees': return sql`COUNT(*) totalRecords,
      ${sum('serviceQuantity', 'totalServices')}, ${sum('serviceAmount', 'totalServiceSales')},
      ${sum('productQuantity', 'totalProducts')}, ${sum('productAmount', 'totalProductSales')},
      ${sum('netAmount', 'totalNetSales')}`;
    case 'erp-commissions': return sql`COUNT(*) totalRecords, ${sum('serviceCount', 'totalServices')}, ${sum('netAmount', 'totalCommission')}`;
    case 'erp-discounts': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalDiscount')}`;
    case 'erp-refunds': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalRefunds')}`;
    case 'erp-voids': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalVoids')}`;
    case 'erp-expenses': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalNetExpenses')}`;
    case 'erp-purchases': return sql`COUNT(*) totalRecords, ${sum('amount', 'totalNetPurchases')}`;
    case 'erp-transfers': return sql`COUNT(*) totalRecords, ${sum('quantity', 'totalQuantity')}, ${sum('totalCost', 'totalTransferCost')}`;
    case 'erp-stock': return sql`COUNT(*) totalRecords, ${sum('availableQuantity', 'totalAvailableQuantity')}, ${sum('inventoryValue', 'totalInventoryValue')}`;
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
