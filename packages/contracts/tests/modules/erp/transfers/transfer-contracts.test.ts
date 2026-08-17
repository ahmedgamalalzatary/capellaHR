import { describe, expect, it } from 'vitest';

import {
  createStockTransferSchema,
  listStockTransfersQuerySchema,
} from '../../../../src/modules/erp/transfers/index.js';

const key = '018f47a6-7b2f-7c41-91e9-a5dd1d8e1640';
const transfer = {
  idempotencyKey: key,
  sourceBranchId: '2',
  destinationBranchId: '3',
  lines: [{ productId: '7', quantity: 2 }],
};

describe('ERP stock transfer contracts', () => {
  it('coerces the two branches and the lines a transfer needs, with no seller', () => {
    expect(createStockTransferSchema.parse({ ...transfer, note: '  نقل مخزون  ' })).toEqual({
      idempotencyKey: key,
      sourceBranchId: 2,
      destinationBranchId: 3,
      note: 'نقل مخزون',
      lines: [{ productId: 7, quantity: 2 }],
    });
    // Internal trade: no employee sells it, so a seller is not part of it.
    expect(createStockTransferSchema.safeParse({ ...transfer, sellerEmployeeId: 11 }).success)
      .toBe(false);
  });

  it('leaves the note out when none was written', () => {
    expect(createStockTransferSchema.parse(transfer).note).toBeUndefined();
    expect(createStockTransferSchema.parse({ ...transfer, note: '   ' }).note).toBeNull();
  });

  it('moves many products in one transfer', () => {
    const many = createStockTransferSchema.parse({
      ...transfer,
      lines: [
        { productId: '7', quantity: 2 },
        { productId: '8', quantity: 5 },
        { productId: '9', quantity: 1 },
      ],
    });

    expect(many.lines).toEqual([
      { productId: 7, quantity: 2 },
      { productId: 8, quantity: 5 },
      { productId: 9, quantity: 1 },
    ]);
  });

  it('refuses a transfer that never leaves its own branch', () => {
    const sameBranch = createStockTransferSchema.safeParse({
      ...transfer, destinationBranchId: '2',
    });

    expect(sameBranch.success).toBe(false);
    expect(sameBranch.error?.issues[0]?.path).toEqual(['destinationBranchId']);
  });

  it('rejects a repeated product, an empty transfer and unusable quantities', () => {
    const repeated = createStockTransferSchema.safeParse({
      ...transfer,
      lines: [{ productId: 7, quantity: 1 }, { productId: 7, quantity: 2 }],
    });

    expect(repeated.success).toBe(false);
    expect(repeated.error?.issues[0]?.path).toEqual(['lines', 1, 'productId']);
    expect(createStockTransferSchema.safeParse({ ...transfer, lines: [] }).success).toBe(false);
    expect(createStockTransferSchema.safeParse({
      ...transfer, lines: [{ productId: 7, quantity: 0 }],
    }).success).toBe(false);
    expect(createStockTransferSchema.safeParse({
      ...transfer, lines: [{ productId: 7, quantity: 1.5 }],
    }).success).toBe(false);
    expect(createStockTransferSchema.safeParse({ ...transfer, idempotencyKey: 'nope' }).success)
      .toBe(false);
  });

  it('defaults transfer paging and keeps the period the right way round', () => {
    expect(listStockTransfersQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(listStockTransfersQuerySchema.parse({ branchId: '2', from: '2026-08-01', to: '2026-08-09' }))
      .toMatchObject({ branchId: 2, from: '2026-08-01', to: '2026-08-09' });
    const backwards = listStockTransfersQuerySchema.safeParse({ from: '2026-08-09', to: '2026-08-01' });
    expect(backwards.success).toBe(false);
    expect(backwards.error?.issues[0]?.path).toEqual(['to']);
  });
});
