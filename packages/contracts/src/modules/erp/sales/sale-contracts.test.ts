import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  completeSaleSchema,
  invoiceSchema,
  invoiceTotalsSchema,
  paymentBreakdownSchema,
  paymentMethodSchema,
  saleErrorSchema,
  saleFixtures,
} from './index.js';

const validDraft = {
  branchId: 2,
  clientId: 5,
  assignedEmployeeId: 8,
  cashierSessionId: 13,
  idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
  lines: [
    { itemType: 'service' as const, serviceId: 21, quantity: 1 },
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
  it('keeps validation messages as correctly decoded Arabic', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
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

  it('publishes exact server-computed totals and rejects inconsistent arithmetic', () => {
    const totals = {
      subtotal: '200.00',
      discountAmount: '20.00',
      taxAmount: '5.00',
      total: '185.00',
      paymentTotal: '185.00',
    };
    expect(invoiceTotalsSchema.parse(totals)).toEqual(totals);
    expect(invoiceTotalsSchema.safeParse({ ...totals, total: '184.99' }).success).toBe(false);
    expect(invoiceTotalsSchema.safeParse({ ...totals, paymentTotal: '184.99' }).success).toBe(false);
  });

  it('requires individual payment rows to sum exactly to the invoice total', () => {
    const valid = {
      total: '185.00',
      payments: [
        { method: 'cash', amount: '100.00' },
        { method: 'visa', amount: '85.00' },
      ],
    };
    expect(paymentBreakdownSchema.parse(valid)).toEqual(valid);
    expect(paymentBreakdownSchema.safeParse({
      ...valid,
      payments: [
        { method: 'cash', amount: '100.00' },
        { method: 'visa', amount: '84.99' },
      ],
    }).success).toBe(false);
  });

  it('publishes stored historical invoice facts without persistence-only fields', () => {
    expect(completeSaleSchema.parse(saleFixtures.serviceSaleDraft))
      .toEqual(saleFixtures.serviceSaleDraft);
    expect(invoiceSchema.parse(saleFixtures.completedInvoice)).toEqual(saleFixtures.completedInvoice);
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      internalSequenceDate: '2026-08-03',
    }).success).toBe(false);
  });

  it('rejects stored adjustment and commission states that cannot be persisted', () => {
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      discount: { kind: 'percentage', value: '100.01', amount: '20.00' },
    }).success).toBe(false);
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: [{ ...saleFixtures.completedInvoice.lines[0], commissionRule: 'none' }],
    }).success).toBe(false);
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: [{
        ...saleFixtures.completedInvoice.lines[0],
        itemType: 'product',
        productCostBasis: '50.00',
        commissionRule: 'none',
        commissionRate: '10.00',
        commissionAmount: '20.00',
      }],
    }).success).toBe(false);
  });

  it('rejects stored invoice snapshots whose cross-field arithmetic is inconsistent', () => {
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: [{
        ...saleFixtures.completedInvoice.lines[0],
        unitPrice: '199.00',
        lineTotal: '199.00',
        commissionAmount: '29.85',
      }],
    }).success).toBe(false);
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      discount: null,
    }).success).toBe(false);
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      tax: { kind: 'fixed', value: '5.00', amount: '4.00' },
    }).success).toBe(false);
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: [{
        ...saleFixtures.completedInvoice.lines[0],
        commissionAmount: '29.99',
      }],
    }).success).toBe(false);
  });

  it('publishes stable validation and conflict errors for the POS', () => {
    for (const value of Object.values(saleFixtures.errors)) {
      expect(saleErrorSchema.parse(value)).toEqual(value);
    }
    expect(saleErrorSchema.safeParse({ code: 'SQL_FAILURE', message: 'secret' }).success).toBe(false);
  });
});
