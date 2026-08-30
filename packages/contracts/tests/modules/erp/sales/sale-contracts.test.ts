import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  branchCashierRosterItemSchema,
  branchCashierRosterQuerySchema,
  replaceBranchCashierRosterSchema,
  completeSaleSchema,
  invoiceSchema,
  invoiceHistoryItemSchema,
  invoiceHistoryQuerySchema,
  invoiceParamsSchema,
  invoiceTotalsSchema,
  paymentBreakdownSchema,
  paymentMethodSchema,
  quoteSaleInputSchema,
  saleQuoteSchema,
  clientVisitHistoryQuerySchema,
  clientVisitSummarySchema,
  saleErrorSchema,
  saleFixtures,
  refundInvoiceSchema,
  refundQuoteInputSchema,
  refundQuoteSchema,
  reassignInvoiceLineSchema,
  recordInvoicePaymentSchema,
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
  it('allows zero or short payment only for product-only sale commands', () => {
    const productOnly = {
      ...validDraft,
      lines: [{ itemType: 'product' as const, productId: 34, quantity: 2 }],
      payments: [],
    };
    expect(completeSaleSchema.safeParse(productOnly).success).toBe(true);
    expect(completeSaleSchema.safeParse({ ...validDraft, payments: [] }).success).toBe(false);
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

  it('keeps validation messages as correctly decoded Arabic', () => {
    const source = readFileSync(
      new URL('../../../../src/modules/erp/sales/index.ts', import.meta.url),
      'utf8',
    );
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

  it('carries the performing employee on service and product lines', () => {
    const productLine = {
      ...saleFixtures.completedInvoice.lines[0],
      itemType: 'product' as const,
      sourceId: 34,
      employee: null,
      originalEmployee: null,
      reassignments: [],
      commissionRule: 'service_default' as const,
      commissionRate: '10.00',
      commissionAmount: '20.00',
      productCostBasis: '50.00',
    };

    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: [productLine],
    }).success).toBe(true);
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: [{ ...saleFixtures.completedInvoice.lines[0], employee: null }],
    }).success).toBe(false);
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: [{
        ...productLine,
        employee: { id: 8, employeeCode: 1008, name: 'سارة علي' },
      }],
    }).success).toBe(true);
  });

  it('publishes one invoice holding two different service employees', () => {
    const [line] = saleFixtures.completedInvoice.lines;
    const parsed = invoiceSchema.parse({
      ...saleFixtures.completedInvoice,
      lines: [
        line,
        {
          ...line,
          id: 82,
          lineNumber: 2,
          sourceId: 22,
          employee: { id: 11, employeeCode: 1011, name: 'هدى محمود' },
        },
      ],
      discount: { kind: 'percentage' as const, value: '10.00', amount: '40.00' },
      totals: {
        subtotal: '400.00',
        discountAmount: '40.00',
        taxAmount: '5.00',
        total: '365.00',
        paymentTotal: '365.00',
        amountPaid: '365.00',
        creditedAmount: '0.00',
        balanceDue: '0.00',
        settlementStatus: 'settled' as const,
      },
      payments: [{
        method: 'cash', amount: '365.00', refundedAmount: '0.00', refundableAmount: '365.00',
      }],
    });
    expect(parsed.lines.map((row) => row.employee?.id)).toEqual([8, 11]);
    expect(parsed).not.toHaveProperty('assignedEmployee');
  });

  it('publishes current and original employees with reassignment history', () => {
    const [line] = saleFixtures.completedInvoice.lines;
    const originalEmployee = line.employee;
    const currentEmployee = { id: 11, employeeCode: 1011, name: 'هدى محمود' };
    const reassignment = {
      id: 91,
      fromEmployee: originalEmployee,
      toEmployee: currentEmployee,
      reason: 'الموظفة المنفذة فعليًا',
      actingAccount: { id: 4, username: 'cashier' },
      createdAt: '2026-08-03T12:00:00.000Z',
    };
    const parsed = invoiceSchema.parse({
      ...saleFixtures.completedInvoice,
      lines: [{
        ...line,
        employee: currentEmployee,
        originalEmployee,
        reassignments: [reassignment],
      }],
    });
    expect(parsed.lines[0]).toMatchObject({ employee: currentEmployee, originalEmployee });
    expect(parsed.lines[0]?.reassignments).toEqual([reassignment]);
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

  it('publishes exact server-computed totals and rejects inconsistent arithmetic', () => {
    const totals = {
      subtotal: '200.00',
      discountAmount: '20.00',
      taxAmount: '5.00',
      total: '185.00',
      paymentTotal: '185.00',
      amountPaid: '185.00',
      creditedAmount: '0.00',
      balanceDue: '0.00',
      settlementStatus: 'settled' as const,
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

  it('rejects an invoice whose stored payment rows disagree with paymentTotal', () => {
    const result = invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      totals: { ...saleFixtures.completedInvoice.totals, paymentTotal: '100.00', amountPaid: '100.00', balanceDue: '85.00', settlementStatus: 'open' },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected invoice validation to fail');
    expect(result.error.issues).toContainEqual(expect.objectContaining({
      path: ['totals', 'paymentTotal'],
      message: 'إجمالي المدفوعات لا يطابق سجلات الدفع',
    }));
  });

  it('allows a payment method to repeat across later instalments', () => {
    expect(paymentBreakdownSchema.safeParse({
      total: '300.00',
      payments: [
        { method: 'cash', amount: '100.00' },
        { method: 'cash', amount: '50.00' },
      ],
      allowPartialPayment: true,
      allowRepeatedMethods: true,
    }).success).toBe(true);
  });

  it('publishes the selling cashier on invoices and keeps legacy invoices seller-free', () => {
    expect(invoiceSchema.parse(saleFixtures.completedInvoice).seller)
      .toEqual(saleFixtures.completedInvoice.seller);
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      seller: null,
    }).success).toBe(true);
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      seller: { id: 9, employeeCode: 1009, name: 'أحمد جمال', username: 'must-not-leak' },
    }).success).toBe(false);
  });

  it('validates branch cashier roster reads and full replacements', () => {
    expect(branchCashierRosterQuerySchema.parse({ branchId: '2' })).toEqual({ branchId: 2 });
    expect(branchCashierRosterQuerySchema.parse({})).toEqual({});
    const member = { id: 8, employeeCode: 1008, fullName: 'سارة علي' };
    expect(branchCashierRosterItemSchema.parse(member)).toEqual(member);
    expect(replaceBranchCashierRosterSchema.parse({ employeeIds: [8, 9] }))
      .toEqual({ employeeIds: [8, 9] });
    expect(replaceBranchCashierRosterSchema.parse({ employeeIds: [] })).toEqual({ employeeIds: [] });
    expect(replaceBranchCashierRosterSchema.safeParse({ employeeIds: [8, 8] }).success).toBe(false);
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

  it('publishes reversal history and remaining refundable quantities and tenders', () => {
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: saleFixtures.completedInvoice.lines.map((line) => ({
        ...line, refundedQuantity: 0, refundableQuantity: line.quantity,
      })),
      payments: saleFixtures.completedInvoice.payments.map((payment) => ({
        ...payment, refundedAmount: '0.00', refundableAmount: payment.amount,
      })),
      reversals: [],
      eligibility: { canVoid: true, canRefund: true },
    }).success).toBe(true);
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

  it('rejects duplicate invoice lines in refund quote requests', () => {
    expect(refundQuoteInputSchema.safeParse({
      lines: [
        { invoiceLineId: 81, quantity: 1 },
        { invoiceLineId: 81, quantity: 1 },
      ],
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
    expect(saleErrorSchema.parse({
      code: 'INVOICE_NOT_FOUND', message: 'الفاتورة غير موجودة',
    }).code).toBe('INVOICE_NOT_FOUND');
    expect(saleErrorSchema.parse({
      code: 'PRICE_CHANGED', message: 'تغير سعر الخدمة',
    }).code).toBe('PRICE_CHANGED');
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

  it('publishes paged client visit-history summaries', () => {
    expect(clientVisitHistoryQuerySchema.parse({ page: '2', pageSize: '10', branchId: '3' }))
      .toEqual({ page: 2, pageSize: 10, branchId: 3 });
    expect(clientVisitSummarySchema.safeParse({
      id: 44,
      invoiceNumber: 'INV-2026.08.03-14.35-17',
      status: 'completed',
      total: '185.00',
      employees: [{ id: 8, name: 'سارة علي' }, { id: 11, name: 'هدى محمود' }],
      soldAt: '2026-08-03T11:35:00.000Z',
    }).success).toBe(true);
    expect(clientVisitSummarySchema.safeParse({
      id: 44,
      invoiceNumber: 'INV-2026.08.03-14.35-17',
      status: 'completed',
      total: '185.00',
      employees: [{ id: 8, name: 'سارة علي' }, { id: 8, name: 'سارة علي' }],
      soldAt: '2026-08-03T11:35:00.000Z',
    }).success).toBe(false);
  });

  it('publishes branch-scoped paged invoice history and detail parameters', () => {
    expect(invoiceHistoryQuerySchema.parse({
      page: '2', pageSize: '10', branchId: '3', search: '  01012345678  ',
    })).toEqual({ page: 2, pageSize: 10, branchId: 3, search: '01012345678' });
    expect(invoiceParamsSchema.parse({ invoiceId: '44' })).toEqual({ invoiceId: 44 });
    expect(invoiceParamsSchema.safeParse({ invoiceId: '0' }).success).toBe(false);
  });

  it('publishes receipt-safe stored invoice history summaries', () => {
    expect(invoiceHistoryItemSchema.safeParse({
      id: 44,
      invoiceNumber: 'INV-2026.08.03-14.35-17',
      status: 'completed',
      total: '185.00',
      amountPaid: '185.00', balanceDue: '0.00', settlementStatus: 'settled',
      client: { id: 5, name: 'منى أحمد', phone: '01012345678' },
      employees: [{ id: 8, name: 'سارة علي' }, { id: 11, name: 'هدى محمود' }],
      soldAt: '2026-08-03T11:35:00.000Z',
    }).success).toBe(true);
  });

  it('keeps a phone-only client identifiable in the stored history summary', () => {
    const parsed = invoiceHistoryItemSchema.safeParse({
      id: 44,
      invoiceNumber: 'INV-2026.08.03-14.35-17',
      status: 'completed',
      total: '185.00',
      amountPaid: '185.00', balanceDue: '0.00', settlementStatus: 'settled',
      client: { id: 5, name: null, phone: '01012345678' },
      employees: [],
      soldAt: '2026-08-03T11:35:00.000Z',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.client.phone).toBe('01012345678');
  });

  it('refuses a stored invoice that names no client at all', () => {
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      client: { ...saleFixtures.completedInvoice.client, name: null, phone: null },
    }).success).toBe(false);
  });
});
