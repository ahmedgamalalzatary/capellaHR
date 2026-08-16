import { describe, expect, it } from 'vitest';

import {
  cancelPurchaseSchema,
  createPurchaseSchema,
  createSupplierSchema,
  listPurchasesQuerySchema,
  updateSupplierSchema,
} from '../../../../src/modules/erp/suppliers/index.js';

describe('ERP supplier and purchase contracts', () => {
  it('normalizes supplier fields and requires an editable update', () => {
    expect(createSupplierSchema.parse({ branchId: '2', name: '  Nile Supply  ', phone: ' 01012345678 ', notes: '  ' })).toEqual({
      branchId: 2, name: 'Nile Supply', phone: '01012345678', notes: null,
    });
    expect(updateSupplierSchema.safeParse({ branchId: 2 }).success).toBe(false);
    expect(updateSupplierSchema.parse({ branchId: 2, phone: '   ' }).phone).toBeNull();
  });

  it('accepts exact purchase costs and rejects duplicate products or invalid quantities', () => {
    expect(createPurchaseSchema.parse({
      branchId: '2', idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630', supplierId: 3, purchaseDate: '2026-08-05',
      lines: [{ productId: 7, quantity: 2, unitCost: '12.5' }],
    })).toEqual({
      branchId: 2, idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630', supplierId: 3, purchaseDate: '2026-08-05',
      lines: [{ productId: 7, quantity: 2, unitCost: '12.50' }],
    });
    expect(createPurchaseSchema.safeParse({ branchId: 2, idempotencyKey: 'not-a-uuid', supplierId: 3, purchaseDate: '2026-08-05', lines: [{ productId: 7, quantity: 1, unitCost: '1' }] }).success).toBe(false);
    const validKey = '018f47a6-7b2f-7c41-91e9-a5dd1d8e1631';
    expect(createPurchaseSchema.safeParse({ branchId: 2, idempotencyKey: validKey, supplierId: 3, purchaseDate: '2026-08-05', lines: [{ productId: 7, quantity: 0, unitCost: '1' }] }).success).toBe(false);
    expect(createPurchaseSchema.safeParse({ branchId: 2, idempotencyKey: validKey, supplierId: 3, purchaseDate: '2026-08-05', lines: [
      { productId: 7, quantity: 1, unitCost: '1' }, { productId: 7, quantity: 1, unitCost: '2' },
    ] }).success).toBe(false);
    expect(createPurchaseSchema.safeParse({ branchId: 2, idempotencyKey: validKey, supplierId: 3, purchaseDate: '2026-08-05', lines: [
      { productId: 7, quantity: 2, unitCost: '9999999999.99' },
    ] }).success).toBe(false);
  });

  it('validates cancellation reasons and history filters', () => {
    expect(cancelPurchaseSchema.parse({ branchId: '2', reason: '  خطأ في الكمية  ' })).toEqual({ branchId: 2, reason: 'خطأ في الكمية' });
    expect(cancelPurchaseSchema.safeParse({ branchId: 2, reason: '' }).success).toBe(false);
    expect(listPurchasesQuerySchema.parse({ branchId: '2', supplierId: '3', productId: '7', page: '2' })).toMatchObject({
      branchId: 2, supplierId: 3, productId: 7, page: 2, pageSize: 20,
    });
  });
});
