import { describe, expect, it } from 'vitest';

import {
  adjustProductStockSchema,
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from './index.js';

describe('ERP product and stock contracts', () => {
  it('normalizes exact product money and blank descriptions', () => {
    expect(createProductSchema.parse({
      branchId: '2', name: '  Shampoo  ', description: '  ', sellingPrice: '125.5',
      lastPurchaseCost: '80', lowStockThreshold: 4,
    })).toEqual({
      branchId: 2, name: 'Shampoo', description: null, sellingPrice: '125.50',
      lastPurchaseCost: '80.00', lowStockThreshold: 4,
    });
  });

  it('rejects invalid money, negative thresholds, and empty updates', () => {
    const validProduct = {
      branchId: 2, name: 'X', sellingPrice: '10', lastPurchaseCost: '0', lowStockThreshold: 0,
    };
    expect(createProductSchema.safeParse({ ...validProduct, sellingPrice: '0' }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...validProduct, lowStockThreshold: -1 }).success).toBe(false);
    expect(updateProductSchema.safeParse({ branchId: 2 }).success).toBe(false);
  });

  it('accepts only explicit stocktaking reasons and non-zero signed deltas', () => {
    expect(adjustProductStockSchema.parse({ branchId: 2, quantityDelta: -3, reason: 'damage', note: 'Broken bottles' })).toEqual({
      branchId: 2, quantityDelta: -3, reason: 'damage', note: 'Broken bottles',
    });
    expect(adjustProductStockSchema.safeParse({ branchId: 2, quantityDelta: 0, reason: 'damage' }).success).toBe(false);
    expect(adjustProductStockSchema.safeParse({ branchId: 2, quantityDelta: 2, reason: 'damage' }).success).toBe(false);
    expect(adjustProductStockSchema.safeParse({ branchId: 2, quantityDelta: 2, reason: 'sale' }).success).toBe(false);
  });

  it('coerces product search, low-stock, and pagination query values', () => {
    expect(listProductsQuerySchema.parse({ branchId: '3', lowStock: 'true', page: '2' })).toMatchObject({
      branchId: 3, lowStock: true, page: 2, pageSize: 20,
    });
  });
});
