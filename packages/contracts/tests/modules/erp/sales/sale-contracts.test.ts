import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  completeSaleSchema,
  paymentMethodSchema,
  recordInvoicePaymentSchema,
  reassignInvoiceLineSchema,
  refundInvoiceSchema,
  refundQuoteSchema,
  voidInvoiceSchema,
} from '../../../../src/modules/erp/sales/index.js';

const validDraft = {
  branchId: 2,
  clientId: 5,
  sellerEmployeeId: 9,
  cashierSessionId: 13,
  idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
  lines: [
    { itemType: 'service' as const, serviceId: 21, quantity: 1, unitPrice: '200', employeeId: 8 },
    { itemType: 'product' as const, productId: 34, quantity: 2 },
  ],
  discount: { kind: 'percentage' as const, value: '10' },
  tax: { kind: 'fixed' as const, value: '5.00' },
  payments: [
    { method: 'cash' as const, amount: '100' },
    { method: 'visa' as const, amount: '80.00' },
  ],
};

describe('ERP complete-sale contracts', () => {
  it('caps each service line at the supported queue cardinality', () => {
    expect(completeSaleSchema.safeParse({
      ...validDraft,
      lines: [{ ...validDraft.lines[0], quantity: 101 }],
    }).success).toBe(false);
  });
  it('accepts an optional booking handover', () => {
    const parsed = completeSaleSchema.parse({
      clientId: 5,
      sellerEmployeeId: 9,
      cashierSessionId: 13,
      bookingId: 22,
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
      lines: [{
        itemType: 'service', serviceId: 21, quantity: 1,
        unitPrice: '200.00', employeeId: 8,
      }],
      payments: [{ method: 'cash', amount: '200.00' }],
    });
    expect(parsed.bookingId).toBe(22);
  });
  it('allows empty payments on sale commands; full payment for services is enforced at completion', () => {
    const productOnly = {
      ...validDraft,
      lines: [{ itemType: 'product' as const, productId: 34, quantity: 2 }],
      payments: [],
    };
    expect(completeSaleSchema.safeParse(productOnly).success).toBe(true);
    expect(completeSaleSchema.safeParse({ ...validDraft, payments: [] }).success).toBe(true);
  });

  it('validates idempotent later invoice payments', () => {
    expect(recordInvoicePaymentSchema.parse({
      cashierSessionId: 13,
      method: 'cash',
      amount: '100',
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1634',
    })).toEqual({
      cashierSessionId: 13,
      method: 'cash',
      amount: '100.00',
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1634',
    });
    expect(recordInvoicePaymentSchema.safeParse({
      cashierSessionId: 13, method: 'cash', amount: '0', operationReference: 'bad',
    }).success).toBe(false);
  });

  it('validates idempotent employee reassignment commands', () => {
    expect(reassignInvoiceLineSchema.parse({
      branchId: 2,
      employeeId: 11,
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1633',
      reason: '  الموظفة المنفذة فعليًا  ',
    })).toEqual({
      branchId: 2,
      employeeId: 11,
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1633',
      reason: 'الموظفة المنفذة فعليًا',
    });
    expect(reassignInvoiceLineSchema.safeParse({
      employeeId: 11,
      operationReference: 'not-a-uuid',
      reason: '   ',
    }).success).toBe(false);
  });

  it('validates idempotent void commands with a required trimmed reason', () => {
    expect(voidInvoiceSchema.parse({
      branchId: 2,
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1631',
      reason: '  إدخال مكرر  ',
    })).toEqual({
      branchId: 2,
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1631',
      reason: 'إدخال مكرر',
    });
    expect(voidInvoiceSchema.safeParse({
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1631', reason: '   ',
    }).success).toBe(false);
  });

  it('validates partial refund quantities and original payment-method allocation', () => {
    const value = {
      branchId: 2,
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1632',
      reason: 'عدم رضا العميل',
      lines: [{ invoiceLineId: 81, quantity: 1 }],
      payments: [
        { method: 'cash' as const, amount: '80' },
        { method: 'visa' as const, amount: '20.00' },
      ],
    };
    expect(refundInvoiceSchema.parse(value).payments).toEqual([
      { method: 'cash', amount: '80.00' },
      { method: 'visa', amount: '20.00' },
    ]);
    expect(refundInvoiceSchema.safeParse({
      ...value,
      lines: [...value.lines, value.lines[0]],
    }).success).toBe(false);
    expect(refundInvoiceSchema.safeParse({
      ...value,
      payments: [value.payments[0], value.payments[0]],
    }).success).toBe(false);
  });

  it('keeps validation messages as correctly decoded Arabic', () => {
    const salesDir = new URL('../../../../src/modules/erp/sales/', import.meta.url);
    const source = [
      'index.ts',
      'cashier-sessions.ts',
      'sale-commands.ts',
      'invoice-contracts.ts',
    ].map((name) => readFileSync(new URL(name, salesDir), 'utf8')).join('\n');
    expect(source).not.toContain('Ã');
    for (const message of [
      'قيمة التعديل الثابت غير متسقة',
      'عمولة الخدمة غير متسقة',
      'مجموع البنود لا يساوي المجموع الفرعي',
      'قيمة التعديل غير متسقة',
    ]) expect(source).toContain(message);
  });

  it('accepts the locked payment methods only', () => {
    expect(paymentMethodSchema.options).toEqual(['cash', 'visa', 'instapay', 'vodafone_cash']);
    expect(paymentMethodSchema.safeParse('mastercard').success).toBe(false);
  });

  it('normalizes exact money and percentage/fixed adjustments without JS floats', () => {
    const parsed = completeSaleSchema.parse(validDraft);
    expect(parsed.discount).toEqual({ kind: 'percentage', value: '10.00' });
    expect(parsed.tax).toEqual({ kind: 'fixed', value: '5.00' });
    expect(parsed.payments).toEqual([
      { method: 'cash', amount: '100.00' },
      { method: 'visa', amount: '80.00' },
    ]);
    expect(completeSaleSchema.safeParse({
      ...validDraft,
      payments: [{ method: 'cash', amount: 180 }],
    }).success).toBe(false);
  });

  it('requires one source matching each line type and forbids duplicate payment methods', () => {
    expect(completeSaleSchema.safeParse({
      ...validDraft,
      lines: [{ itemType: 'service', productId: 4, quantity: 1 }],
    }).success).toBe(false);
    expect(completeSaleSchema.safeParse({
      ...validDraft,
      payments: [
        { method: 'cash', amount: '50' },
        { method: 'cash', amount: '130' },
      ],
    }).success).toBe(false);
  });

  it('requires an employee on every service line and rejects one on a product line', () => {
    expect(completeSaleSchema.safeParse({
      ...validDraft,
      lines: [{ itemType: 'product' as const, productId: 34, quantity: 2 }],
    }).success).toBe(true);
    expect(completeSaleSchema.safeParse({
      ...validDraft,
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200' }],
    }).success).toBe(false);
    expect(completeSaleSchema.safeParse({
      ...validDraft,
      lines: [{ itemType: 'product', productId: 34, quantity: 2, employeeId: 8 }],
    }).success).toBe(false);
  });

  it('lets each service line name its own employee', () => {
    const parsed = completeSaleSchema.parse({
      ...validDraft,
      lines: [
        { itemType: 'service' as const, serviceId: 21, quantity: 1, unitPrice: '200', employeeId: 8 },
        { itemType: 'service' as const, serviceId: 22, quantity: 1, unitPrice: '150', employeeId: 11 },
        { itemType: 'product' as const, productId: 34, quantity: 2 },
      ],
    });
    expect(parsed.lines.map((line) => ('employeeId' in line ? line.employeeId : null)))
      .toEqual([8, 11, null]);
    expect(parsed).not.toHaveProperty('assignedEmployeeId');
  });

  it('no longer accepts an invoice-level assigned employee', () => {
    expect(completeSaleSchema.safeParse({ ...validDraft, assignedEmployeeId: 8 }).success)
      .toBe(false);
  });

  it('requires the selling cashier on every sale, services and products alike', () => {
    const { sellerEmployeeId, ...withoutSeller } = validDraft;
    expect(sellerEmployeeId).toBeDefined();
    expect(completeSaleSchema.safeParse(withoutSeller).success).toBe(false);

    const productOnly = {
      ...withoutSeller,
      sellerEmployeeId,
      lines: [{ itemType: 'product' as const, productId: 34, quantity: 2 }],
    };
    expect(completeSaleSchema.safeParse(productOnly).success).toBe(true);
    expect(completeSaleSchema.safeParse({ ...productOnly, sellerEmployeeId: 0 }).success).toBe(false);
  });

  it('requires and normalizes a positive unit price for every service sale line', () => {
    expect(completeSaleSchema.parse(validDraft).lines[0]).toMatchObject({ unitPrice: '200.00' });
    expect(completeSaleSchema.safeParse({
      ...validDraft,
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
    }).success).toBe(false);
    expect(completeSaleSchema.safeParse({
      ...validDraft,
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '0' }],
    }).success).toBe(false);
    expect(completeSaleSchema.safeParse({
      ...validDraft,
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '12345678901' }],
    }).success).toBe(false);
  });

  it('caps percentage adjustments at 100 and keeps fixed adjustments as money', () => {
    expect(completeSaleSchema.safeParse({
      ...validDraft,
      discount: { kind: 'percentage', value: '100.01' },
    }).success).toBe(false);
    expect(completeSaleSchema.parse({
      ...validDraft,
      discount: { kind: 'fixed', value: '100.01' },
    }).discount).toEqual({ kind: 'fixed', value: '100.01' });
  });

  it('supports zero-net refund lines without a payment movement', () => {
    expect(refundInvoiceSchema.safeParse({
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1632',
      reason: 'إرجاع بند مخصوم بالكامل',
      lines: [{ invoiceLineId: 81, quantity: 1 }],
      payments: [],
    }).success).toBe(true);
    expect(refundQuoteSchema.safeParse({
      lines: [{
        invoiceLineId: 81, quantity: 1, grossAmount: '0.01',
        discountAmount: '0.01', taxAmount: '0.00', total: '0.00',
      }],
      totals: {
        grossAmount: '0.01', discountAmount: '0.01', taxAmount: '0.00', total: '0.00',
      },
      cashPayout: '0.00',
      payments: [],
    }).success).toBe(true);
  });
});
