import { describe, expect, it } from 'vitest';

import {
  allocateReversalAmounts,
  calculateAdjustment,
  calculateCommission,
  calculateLineTotal,
  calculateSaleTotals,
  MoneyCalculationError,
  sumMoney,
} from './sale-calculations.js';

describe('ERP sale calculations', () => {
  it('allocates fixed invoice adjustments deterministically across partial line quantities', () => {
    expect(allocateReversalAmounts({
      lines: [
        { invoiceLineId: 11, quantity: 3, unitPrice: '10.00', refundedQuantity: 0 },
        { invoiceLineId: 12, quantity: 1, unitPrice: '20.00', refundedQuantity: 0 },
      ],
      selected: [{ invoiceLineId: 11, quantity: 1 }],
      discountAmount: '7.00',
      taxAmount: '3.00',
    })).toEqual({
      lines: [{
        invoiceLineId: 11,
        quantity: 1,
        grossAmount: '10.00',
        discountAmount: '1.40',
        taxAmount: '0.60',
        total: '9.20',
      }],
      grossAmount: '10.00',
      discountAmount: '1.40',
      taxAmount: '0.60',
      total: '9.20',
    });
  });

  it('uses cumulative allocation so repeated partial refunds return every original cent', () => {
    const input = {
      lines: [{ invoiceLineId: 11, quantity: 3, unitPrice: '10.00', refundedQuantity: 0 }],
      discountAmount: '1.00',
      taxAmount: '0.01',
    };
    const first = allocateReversalAmounts({
      ...input,
      selected: [{ invoiceLineId: 11, quantity: 1 }],
    });
    const second = allocateReversalAmounts({
      ...input,
      lines: [{ ...input.lines[0]!, refundedQuantity: 1 }],
      selected: [{ invoiceLineId: 11, quantity: 2 }],
    });

    expect(first.lines[0]).toMatchObject({ discountAmount: '0.33', taxAmount: '0.00' });
    expect(second.lines[0]).toMatchObject({ discountAmount: '0.67', taxAmount: '0.01' });
    expect(sumMoney([first.total, second.total])).toBe('29.01');
  });

  it('preserves a refundable zero-net line created by cent-level discount allocation', () => {
    expect(allocateReversalAmounts({
      lines: [
        { invoiceLineId: 11, quantity: 1, unitPrice: '0.01', refundedQuantity: 0 },
        { invoiceLineId: 12, quantity: 1, unitPrice: '0.01', refundedQuantity: 0 },
      ],
      selected: [{ invoiceLineId: 11, quantity: 1 }],
      discountAmount: '0.01',
      taxAmount: '0.00',
    })).toEqual({
      lines: [{
        invoiceLineId: 11, quantity: 1, grossAmount: '0.01',
        discountAmount: '0.01', taxAmount: '0.00', total: '0.00',
      }],
      grossAmount: '0.01', discountAmount: '0.01', taxAmount: '0.00', total: '0.00',
    });
  });

  it('calculates percentage adjustments with half-up cent rounding', () => {
    expect(calculateAdjustment('10.05', { kind: 'percentage', value: '12.50' })).toBe('1.26');
  });

  it('uses the pre-discount line total as the commission base', () => {
    expect(calculateCommission('200.00', '15.00')).toBe('30.00');
  });

  it('sums exact money without floating-point conversion', () => {
    expect(sumMoney(['999999999999.99', '0.01'])).toBe('1000000000000.00');
  });

  it('rejects line and invoice totals outside DECIMAL(14,2) storage', () => {
    expect(() => calculateLineTotal('9999999999.99', 101))
      .toThrowError(new MoneyCalculationError('MONEY_OUT_OF_RANGE'));
    expect(() => calculateSaleTotals({
      lineTotals: ['999999999999.99', '0.01'],
      payments: [],
    })).toThrowError(new MoneyCalculationError('MONEY_OUT_OF_RANGE'));
  });

  it('calculates discount and tax independently from the subtotal', () => {
    expect(calculateSaleTotals({
      lineTotals: ['200.00', '50.00'],
      discount: { kind: 'percentage', value: '10.00' },
      tax: { kind: 'percentage', value: '14.00' },
      payments: [{ amount: '260.00' }, { amount: '25.00' }],
    })).toEqual({
      subtotal: '250.00',
      discountAmount: '25.00',
      taxAmount: '35.00',
      total: '260.00',
      paymentTotal: '285.00',
    });
  });

  it('rejects a discount larger than the subtotal', () => {
    expect(() => calculateSaleTotals({
      lineTotals: ['20.00'],
      discount: { kind: 'fixed', value: '20.01' },
      payments: [],
    })).toThrowError(new MoneyCalculationError('DISCOUNT_EXCEEDS_SUBTOTAL'));
  });

  it('rejects a zero or negative final total', () => {
    expect(() => calculateSaleTotals({
      lineTotals: ['20.00'],
      discount: { kind: 'fixed', value: '20.00' },
      payments: [],
    })).toThrowError(new MoneyCalculationError('TOTAL_NOT_POSITIVE'));
  });
});
