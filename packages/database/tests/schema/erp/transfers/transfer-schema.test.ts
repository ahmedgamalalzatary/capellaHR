import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import {
  erpStockTransferLines,
  erpStockTransfers,
} from '../../../../src/schema/erp/transfers/index.js';
import {
  erpStockMovements,
  stockMovementReasons,
  stockMovementSourceTypes,
} from '../../../../src/schema/erp/stock/index.js';

describe('ERP stock transfer schema', () => {
  it('records which branches a transfer moved stock between and the sale it became', () => {
    const config = getTableConfig(erpStockTransfers);

    expect(config.columns.map((column) => column.name)).toEqual([
      'id', 'source_branch_id', 'destination_branch_id', 'invoice_id', 'idempotency_key',
      'status', 'transfer_date', 'total_cost', 'acting_account_id', 'note', 'created_at',
    ]);
    expect(config.indexes.map((entry) => entry.config.name)).toEqual(expect.arrayContaining([
      'erp_stock_transfers_idempotency_unique',
      'erp_stock_transfers_id_destination_unique',
    ]));
    // A transfer that never leaves its branch is not a transfer.
    expect(config.checks.map((entry) => entry.name)).toContain(
      'erp_stock_transfers_branches_differ',
    );
  });

  it('ties every line to a product on each side of the move', () => {
    const config = getTableConfig(erpStockTransferLines);

    expect(config.columns.map((column) => column.name)).toEqual([
      'id', 'transfer_id', 'source_branch_id', 'destination_branch_id',
      'source_product_id', 'destination_product_id', 'product_name_snapshot',
      'quantity', 'unit_cost', 'previous_destination_cost', 'line_total',
    ]);
    expect(config.foreignKeys.map((key) => key.getName())).toEqual(expect.arrayContaining([
      'erp_stock_transfer_lines_source_product_fk',
      'erp_stock_transfer_lines_destination_product_fk',
      'erp_stock_transfer_lines_transfer_fk',
    ]));
    expect(config.indexes.map((entry) => entry.config.name)).toContain(
      'erp_stock_transfer_lines_transfer_product_unique',
    );
    expect(config.checks.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      'erp_stock_transfer_lines_quantity_positive',
      'erp_stock_transfer_lines_cost_nonnegative',
      'erp_stock_transfer_lines_total_exact',
    ]));
  });

  it('gives the receiving branch its own movement reason', () => {
    expect(stockMovementReasons).toContain('transfer_in');
    expect(stockMovementSourceTypes).toContain('transfer_in');
    // The sending branch keeps recording a sale, because that is what it is.
    expect(stockMovementReasons).not.toContain('transfer_out');

    const checks = getTableConfig(erpStockMovements).checks
      .map((entry) => entry.value.queryChunks
        .flatMap((chunk) => (chunk instanceof Object && 'value' in chunk ? chunk.value : []))
        .join(' '))
      .join(' | ');

    expect(checks).toContain('transfer_in');
  });
});
