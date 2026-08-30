import { describe, expect, it } from 'vitest';

import {
  adjustProductStockSchema,
  createProductSchema,
  listProductsQuerySchema,
  ean13CheckDigit,
  inStoreBarcodeFor,
  listStockMovementsQuerySchema,
  productBarcodeLookupSchema,
  updateProductSchema,
} from '../../../../src/modules/erp/stock/index.js';

describe('ERP product and stock contracts', () => {
  it('accepts and normalizes a product commission percentage', () => {
    expect(createProductSchema.parse({
      name: 'Shampoo', sellingPrice: '100', commissionPercent: '7.5',
    }).commissionPercent).toBe('7.50');
  });

  it('normalizes exact product money and blank descriptions', () => {
    expect(createProductSchema.parse({
      branchId: '2', name: '  Shampoo  ', description: '  ', sellingPrice: '125.5',
      lastPurchaseCost: '80', lowStockThreshold: 4,
    })).toEqual({
      branchId: 2, name: 'Shampoo', description: null, sellingPrice: '125.50',
      lastPurchaseCost: '80.00', commissionPercent: '0.00', lowStockThreshold: 4, barcode: null,
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

  it('allows purchase cancellation movements in Admin history filters', () => {
    expect(listStockMovementsQuerySchema.parse({ branchId: 2, reason: 'purchase_cancellation' }).reason)
      .toBe('purchase_cancellation');
  });
});

describe('product barcodes', () => {
  it('keeps a supplier code exactly as it was scanned', () => {
    expect(createProductSchema.parse({
      branchId: 2, name: 'Shampoo', sellingPrice: '10', lastPurchaseCost: '0',
      lowStockThreshold: 0, barcode: '  6221031492108  ',
    }).barcode).toBe('6221031492108');
  });

  it('reads an absent or blank barcode as none at all', () => {
    const base = {
      branchId: 2, name: 'Shampoo', sellingPrice: '10', lastPurchaseCost: '0', lowStockThreshold: 0,
    };
    expect(createProductSchema.parse(base).barcode).toBe(null);
    expect(createProductSchema.parse({ ...base, barcode: '   ' }).barcode).toBe(null);
    expect(updateProductSchema.parse({ branchId: 2, barcode: '' }).barcode).toBe(null);
  });

  it('rejects a code the scanner could never have produced', () => {
    const base = {
      branchId: 2, name: 'Shampoo', sellingPrice: '10', lastPurchaseCost: '0', lowStockThreshold: 0,
    };
    expect(createProductSchema.safeParse({ ...base, barcode: '12' }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, barcode: 'ABC 123' }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, barcode: 'كود' }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, barcode: '1'.repeat(33) }).success).toBe(false);
  });

  it('computes the EAN-13 check digit', () => {
    expect(ean13CheckDigit('622103149210')).toBe('5');
    expect(ean13CheckDigit('590123412345')).toBe('7');
    expect(() => ean13CheckDigit('12345')).toThrow();
  });

  it('builds an in-store code inside the 200-299 prefix range', () => {
    const code = inStoreBarcodeFor(41);
    expect(code).toBe('2000000000411');
    expect(code).toHaveLength(13);
    expect(ean13CheckDigit(code.slice(0, 12))).toBe(code.slice(12));
  });

  it('accepts a scanned lookup code with an optional branch', () => {
    expect(productBarcodeLookupSchema.parse({ code: ' 2000000000411 ', branchId: '2' }))
      .toEqual({ code: '2000000000411', branchId: 2 });
    expect(productBarcodeLookupSchema.safeParse({ code: '' }).success).toBe(false);
  });
});
