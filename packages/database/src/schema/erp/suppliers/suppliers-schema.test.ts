import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { erpPurchaseLines, erpPurchases, erpSuppliers } from './index.js';

describe('ERP suppliers and purchases schema', () => {
  it('stores branch-scoped suppliers with stable history-safe lifecycle', () => {
    const config = getTableConfig(erpSuppliers);
    expect(config.columns.map((column) => column.name)).toEqual([
      'id', 'branch_id', 'name', 'name_normalized', 'phone', 'notes', 'is_active', 'created_at', 'updated_at',
    ]);
    expect(config.indexes.some((entry) => entry.config.name === 'erp_suppliers_branch_name_unique')).toBe(true);
  });

  it('stores immutable posted/cancelled purchases and exact line facts', () => {
    expect(getTableConfig(erpPurchases).columns.map((column) => column.name)).toEqual([
      'id', 'branch_id', 'supplier_id', 'supplier_name_snapshot', 'idempotency_key', 'idempotency_fingerprint', 'status', 'purchase_date', 'total', 'acting_account_id',
      'cancelled_at', 'cancelled_by_account_id', 'cancellation_reason', 'corrects_purchase_id', 'created_at',
    ]);
    expect(getTableConfig(erpPurchases).indexes.some((entry) => entry.config.name === 'erp_purchases_idempotency_unique')).toBe(true);
    const line = getTableConfig(erpPurchaseLines);
    expect(line.columns.map((column) => column.name)).toEqual([
      'id', 'purchase_id', 'branch_id', 'product_id', 'product_name_snapshot', 'quantity', 'unit_cost', 'previous_unit_cost', 'line_total',
    ]);
    expect(line.checks.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'erp_purchase_lines_quantity_positive', 'erp_purchase_lines_unit_cost_positive', 'erp_purchase_lines_total_positive',
    ]));
  });
});
