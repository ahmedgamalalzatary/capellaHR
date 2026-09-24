import { describe, expect, it } from 'vitest';

import {
  invoiceTotalsSchema,
  quoteSaleInputSchema,
  refundQuoteInputSchema,
  refundQuoteSchema,
  saleQuoteSchema,
} from '../../../../src/modules/erp/sales/index.js';

describe('ERP complete-sale contracts', () => {
  it('publishes an authoritative partial-refund quote with remaining tenders', () => {
    expect(refundQuoteInputSchema.parse({
      branchId: '2', lines: [{ invoiceLineId: 81, quantity: 1 }],
    })).toEqual({ branchId: 2, lines: [{ invoiceLineId: 81, quantity: 1 }] });
    expect(refundQuoteSchema.safeParse({
      lines: [{
        invoiceLineId: 81, quantity: 1, grossAmount: '200.00',
        discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      }],
      totals: {
        grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      },
      cashPayout: '185.00',
      payments: [{ method: 'cash', paidAmount: '185.00', refundableAmount: '185.00' }],
    }).success).toBe(true);
  });

  it('offers every payment method on a refund quote, including ones the sale never used', () => {
    const quote = {
      lines: [{
        invoiceLineId: 81, quantity: 1, grossAmount: '200.00',
        discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      }],
      totals: {
        grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      },
      cashPayout: '185.00',
      payments: [
        { method: 'cash' as const, paidAmount: '0.00', refundableAmount: '0.00' },
        { method: 'visa' as const, paidAmount: '185.00', refundableAmount: '185.00' },
      ],
    };
    expect(refundQuoteSchema.parse(quote).payments).toEqual(quote.payments);
    // The paid amount is what the till took, so it can never exceed itself.
    expect(refundQuoteSchema.safeParse({
      ...quote,
      payments: [{ method: 'cash', paidAmount: '10.00', refundableAmount: '20.00' }],
    }).success).toBe(false);
  });

  it('derives receivable balance from net cash and return credits', () => {
    expect(invoiceTotalsSchema.safeParse({
      subtotal: '1000.00', discountAmount: '0.00', taxAmount: '0.00',
      total: '1000.00', paymentTotal: '300.00', amountPaid: '300.00',
      creditedAmount: '500.00', balanceDue: '200.00', settlementStatus: 'open',
    }).success).toBe(true);
    expect(refundQuoteSchema.safeParse({
      lines: [{
        invoiceLineId: 81, quantity: 1, grossAmount: '200.00',
        discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      }],
      totals: { grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00' },
      cashPayout: '185.01', payments: [],
    }).success).toBe(false);
  });

  it('rejects duplicate invoice lines in refund quote requests', () => {
    expect(refundQuoteInputSchema.safeParse({
      lines: [
        { invoiceLineId: 81, quantity: 1 },
        { invoiceLineId: 81, quantity: 1 },
      ],
    }).success).toBe(false);
  });

  it('publishes a product commission percentage in sale quotes', () => {
    const result = saleQuoteSchema.safeParse({
      lines: [{
        itemType: 'product', sourceId: 21, name: 'Shampoo', quantity: 1,
        unitPrice: '100.00', lineTotal: '100.00', commissionPercent: '12.50',
      }],
      discount: null,
      tax: null,
      totals: {
        subtotal: '100.00', discountAmount: '0.00', taxAmount: '0.00', total: '100.00',
      },
    });

    expect(result.success).toBe(true);
  });

  it('publishes a mixed catalog quote request and authoritative quote response', () => {
    expect(quoteSaleInputSchema.parse({
      branchId: 2,
      lines: [{ itemType: 'service', serviceId: 21, quantity: 2, unitPrice: '200' }],
      discount: { kind: 'percentage', value: '10' },
      tax: { kind: 'fixed', value: '5' },
    })).toEqual({
      branchId: 2,
      lines: [{ itemType: 'service', serviceId: 21, quantity: 2, unitPrice: '200.00' }],
      discount: { kind: 'percentage', value: '10.00' },
      tax: { kind: 'fixed', value: '5.00' },
    });
    expect(quoteSaleInputSchema.parse({
      lines: [{ itemType: 'product', productId: 34, quantity: 1 }],
    }).lines).toEqual([{ itemType: 'product', productId: 34, quantity: 1 }]);

    expect(saleQuoteSchema.safeParse({
      lines: [{
        itemType: 'service', sourceId: 21, name: 'صبغة شعر', quantity: 2,
        unitPrice: '200.00', lineTotal: '400.00',
      }],
      discount: { kind: 'percentage', value: '10.00', amount: '40.00' },
      tax: { kind: 'fixed', value: '5.00', amount: '5.00' },
      totals: { subtotal: '400.00', discountAmount: '40.00', taxAmount: '5.00', total: '365.00' },
    }).success).toBe(true);
  });

  it('rejects quote totals and adjustments that do not match the quoted lines', () => {
    const quote = {
      lines: [{
        itemType: 'service' as const, sourceId: 21, name: 'صبغة شعر', quantity: 2,
        unitPrice: '200.00', lineTotal: '400.00',
      }],
      discount: { kind: 'percentage' as const, value: '10.00', amount: '40.00' },
      tax: { kind: 'fixed' as const, value: '5.00', amount: '5.00' },
      totals: { subtotal: '400.00', discountAmount: '40.00', taxAmount: '5.00', total: '365.00' },
    };

    expect(saleQuoteSchema.safeParse({
      ...quote,
      totals: { ...quote.totals, subtotal: '500.00', total: '465.00' },
    }).success).toBe(false);
    expect(saleQuoteSchema.safeParse({
      ...quote,
      totals: { ...quote.totals, discountAmount: '30.00', total: '375.00' },
    }).success).toBe(false);
    expect(saleQuoteSchema.safeParse({
      ...quote,
      tax: { ...quote.tax, amount: '4.00' },
    }).success).toBe(false);
  });
});
