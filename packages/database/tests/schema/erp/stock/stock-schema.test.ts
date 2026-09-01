import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import {
  stockMovementReasons,
  erpConsumableBalances,
  erpConsumableConfigurations,
  erpConsumableLedgerEntries,
  erpProductStocks,
  erpStockMovements,
} from '../../../../src/schema/erp/stock/index.js';

describe('ERP product stock schema', () => {
  it('records both sides of whole-package consumables transfers in sellable stock', () => {
    expect(stockMovementReasons).toEqual(expect.arrayContaining([
      'consumable_reserve', 'consumable_return',
    ]));
  });
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

  it('configures package conversion separately from sellable package stock', () => {
    const configuration = getTableConfig(erpConsumableConfigurations);
    expect(configuration.columns.map((column) => column.name)).toEqual([
      'product_id', 'branch_id', 'unit', 'package_size', 'created_at', 'updated_at',
    ]);
    expect(configuration.checks.map((entry) => entry.name)).toContain(
      'erp_consumable_configurations_package_size_positive',
    );

    const balance = getTableConfig(erpConsumableBalances);
    expect(balance.columns.map((column) => column.name)).toEqual([
      'product_id', 'branch_id', 'quantity', 'updated_at',
    ]);
    expect(balance.checks.map((entry) => entry.name)).toContain(
      'erp_consumable_balances_quantity_nonnegative',
    );
  });

  it('keeps an immutable valued ledger for every consumables balance change', () => {
    const config = getTableConfig(erpConsumableLedgerEntries);
    expect(config.columns.map((column) => column.name)).toEqual([
      'id', 'product_id', 'branch_id', 'entry_type', 'quantity_delta', 'balance_after',
      'unit_cost_snapshot', 'total_cost', 'source_type', 'source_id',
      'acting_account_id', 'note', 'created_at',
    ]);
    expect(config.checks.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'erp_consumable_ledger_delta_nonzero',
      'erp_consumable_ledger_balance_nonnegative',
      'erp_consumable_ledger_cost_consistent',
      'erp_consumable_ledger_direction_consistent',
    ]));
  });
});
