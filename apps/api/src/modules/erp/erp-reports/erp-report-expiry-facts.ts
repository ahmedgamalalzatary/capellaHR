import type { ReportFilters } from '@capella/contracts';
import { sql } from 'drizzle-orm';
import { branchFilter, condition, dateFilter, searchFilter } from './erp-report-sql.js';

export const expiryFacts = (filters: ReportFilters) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const status = sql`CASE WHEN batch.expiry_date IS NULL THEN 'unknown'
    WHEN batch.expiry_date < ${today} THEN 'expired'
    WHEN batch.expiry_date <= DATE_ADD(${today}, INTERVAL 30 DAY) THEN 'soon' ELSE 'valid' END`;
  return sql`SELECT balance.id id, balance.updated_at eventDate, branch.name branchName,
    product.name productName, batch.id batchId, product.id productId, branch.id branchId,
    DATE_FORMAT(batch.expiry_date, '%Y-%m-%d') expiryDate, ${status} expiryStatus,
    DATEDIFF(batch.expiry_date, ${today}) daysRemaining, balance.quantity availableQuantity,
    balance.consumable_quantity consumableQuantity, configuration.unit consumableUnit,
    (SELECT GROUP_CONCAT(CONCAT(DATE_FORMAT(movement.created_at, '%Y-%m-%d'), ' ', movement.reason, ' ',
      IF(movement.quantity_delta < 0, '-', '+'), detail.quantity) ORDER BY movement.id SEPARATOR ' | ')
      FROM erp_stock_movements movement
      JOIN JSON_TABLE(movement.batches, '$[*]' COLUMNS(batchId INT PATH '$.batchId', quantity VARCHAR(32) PATH '$.quantity')) detail
      WHERE movement.product_id = product.id AND movement.branch_id = branch.id AND detail.batchId = batch.id) stockHistory,
    (SELECT GROUP_CONCAT(CONCAT(DATE_FORMAT(entry.created_at, '%Y-%m-%d'), ' ', entry.entry_type, ' ',
      IF(entry.quantity_delta < 0, '-', '+'), detail.quantity) ORDER BY entry.id SEPARATOR ' | ')
      FROM erp_consumable_ledger_entries entry
      JOIN JSON_TABLE(entry.batches, '$[*]' COLUMNS(batchId INT PATH '$.batchId', quantity VARCHAR(32) PATH '$.quantity')) detail
      WHERE entry.product_id = product.id AND entry.branch_id = branch.id AND detail.batchId = batch.id) consumableHistory
    FROM erp_stock_batch_balances balance
    INNER JOIN erp_stock_batches batch ON batch.id = balance.batch_id
    INNER JOIN erp_products product ON product.id = balance.product_id AND product.branch_id = balance.branch_id
    INNER JOIN branches branch ON branch.id = balance.branch_id
    LEFT JOIN erp_consumable_configurations configuration ON configuration.product_id = product.id AND configuration.branch_id = branch.id
    ${condition([
      sql`(balance.quantity > 0 OR balance.consumable_quantity > 0)`,
      ...branchFilter(filters, 'balance.branch_id'), ...dateFilter(filters, 'batch.expiry_date'),
      ...searchFilter(filters, ['product.name', 'branch.name', 'CAST(batch.id AS CHAR)']),
      ...(filters.expiryStatus ? [sql`${status} = ${filters.expiryStatus}`] : []),
    ])}`;
};
