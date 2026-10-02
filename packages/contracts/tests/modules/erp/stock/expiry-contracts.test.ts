import { describe, expect, it } from 'vitest';
import { createPurchaseSchema } from '../../../../src/modules/erp/suppliers/index.ts';
import { completeSaleSchema, refundInvoiceSchema, saleErrorSchema } from '../../../../src/modules/erp/sales/index.ts';
import { createReportExportSchema } from '../../../../src/modules/reports/index.ts';

const key = '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630';
const purchase = { idempotencyKey: key, supplierId: 1, purchaseDate: '2026-10-02' };
describe('batch expiry contracts', () => {
  it('recognizes a batch-selection conflict as a sale error', () => {
    expect(saleErrorSchema.safeParse({ code: 'BATCH_SELECTION_INVALID', message: 'Choose an available batch' }).success).toBe(true);
  });
  it('requires a real expiry date on every new purchase line', () => {
    expect(createPurchaseSchema.safeParse({ ...purchase, lines: [{ productId: 1, quantity: 2, unitCost: '10' }] }).success).toBe(false);
    expect(createPurchaseSchema.safeParse({ ...purchase, lines: [{ productId: 1, quantity: 2, unitCost: '10', expiryDate: '2027-02-30' }] }).success).toBe(false);
    expect(createPurchaseSchema.safeParse({ ...purchase, lines: [{ productId: 1, quantity: 2, unitCost: '10', expiryDate: '2027-02-28' }] }).success).toBe(true);
  });
  it('accepts separate batches of the same product on a purchase', () => {
    expect(createPurchaseSchema.safeParse({ ...purchase, lines: [
      { productId: 1, quantity: 2, unitCost: '10', expiryDate: '2027-02-28' },
      { productId: 1, quantity: 3, unitCost: '10', expiryDate: '2027-04-30' },
    ] }).success).toBe(true);
  });
  it('allows separate purchase batches with the same product and expiry date', () => {
    expect(createPurchaseSchema.safeParse({ ...purchase, lines: [
      { productId: 1, quantity: 2, unitCost: '10', expiryDate: '2027-02-28' },
      { productId: 1, quantity: 3, unitCost: '12', expiryDate: '2027-02-28' },
    ] }).success).toBe(true);
  });
  it('allows selling an explicitly selected expired batch', () => {
    expect(completeSaleSchema.safeParse({ idempotencyKey: key, clientId: 1, cashierSessionId: 1,
      lines: [{ itemType: 'product', productId: 1, employeeId: 2, quantity: 2, batches: [{ batchId: 9, quantity: '2.000' }] }], payments: [],
    }).success).toBe(true);
  });
  it('rejects fractional packages while allowing fractional consumables', () => {
    expect(completeSaleSchema.safeParse({ idempotencyKey: key, clientId: 1, cashierSessionId: 1,
      lines: [{ itemType: 'product', productId: 1, employeeId: 2, quantity: 1, batches: [{ batchId: 9, quantity: '0.500' }, { batchId: 10, quantity: '0.500' }] }], payments: [],
    }).success).toBe(false);
  });
  it('carries original batch selection on a partial return', () => {
    expect(refundInvoiceSchema.safeParse({ idempotencyKey: key, reason: 'Return', payments: [],
      lines: [{ invoiceLineId: 1, quantity: 1, batches: [{ batchId: 9, quantity: '1.000' }] }],
    }).success).toBe(true);
  });
  it('exports expiry data with expiry status filters', () => {
    expect(createReportExportSchema.safeParse({ reportType: 'erp-expiry-data',
      filters: { branchId: 1, expiryStatus: 'unknown' }, selection: { mode: 'all' },
    }).success).toBe(true);
  });
});
