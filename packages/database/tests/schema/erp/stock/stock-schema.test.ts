import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { erpProductStocks, erpStockMovements } from '../../../../src/schema/erp/stock/index.js';

describe('ERP product stock schema', () => {
  it('keeps exactly one non-negative balance per product and branch', () => {
    const config = getTableConfig(erpProductStocks);
    expect(config.columns.map((column) => column.name)).toEqual([
      'product_id', 'branch_id', 'quantity', 'updated_at',
    ]);
    expect(config.indexes.some((entry) => entry.config.name === 'erp_product_stocks_product_branch_unique')).toBe(true);
    expect(config.checks.map((entry) => entry.name)).toContain('erp_product_stocks_quantity_nonnegative');
  });

  it('records immutable movement facts with the resulting balance', () => {
    const config = getTableConfig(erpStockMovements);
    expect(config.columns.map((column) => column.name)).toEqual([
      'id', 'product_id', 'branch_id', 'reason', 'source_type', 'source_id',
      'quantity_delta', 'balance_after', 'acting_account_id', 'note', 'created_at',
    ]);
    expect(config.checks.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'erp_stock_movements_delta_nonzero',
      'erp_stock_movements_balance_nonnegative',
      'erp_stock_movements_source_consistent',
      'erp_stock_movements_reason_source_consistent',
      'erp_stock_movements_direction_consistent',
    ]));
  });
});
