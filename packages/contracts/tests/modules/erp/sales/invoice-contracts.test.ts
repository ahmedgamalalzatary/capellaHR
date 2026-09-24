import { describe, expect, it } from 'vitest';

import {
  clientVisitSummarySchema,
  completeSaleSchema,
  invoiceSchema,
  invoiceTotalsSchema,
  paymentBreakdownSchema,
  saleErrorSchema,
  saleFixtures,
  saleQuoteSchema,
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
  it('accepts new numeric and historical invoice numbers', () => {
    for (const number of ['000001', '1000000', 'INV-2026.08.03-14.35-17']) {
      expect(invoiceSchema.safeParse({ ...saleFixtures.completedInvoice, invoiceNumber: number }).success).toBe(true);
      expect(clientVisitSummarySchema.safeParse({
        id: 44, invoiceNumber: number, status: 'completed', total: '185.00',
        employees: [], soldAt: '2026-08-03T11:35:00.000Z',
      }).success).toBe(true);
    }
    for (const number of ['000000', '123', 'INV-1', '000001A']) {
      expect(invoiceSchema.safeParse({ ...saleFixtures.completedInvoice, invoiceNumber: number }).success).toBe(false);
    }
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
      queueNumbers: [],
    };

    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: [productLine],
    }).success).toBe(false);
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

  it('publishes one positive queue number for every unit of a service line', () => {
    const service = saleFixtures.completedInvoice.lines[0];
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: [{ ...service, quantity: 3, lineTotal: '600.00', commissionAmount: '90.00', refundableQuantity: 3, queueNumbers: [4, 5, 6] }],
      totals: { ...saleFixtures.completedInvoice.totals, subtotal: '600.00', discountAmount: '60.00', total: '545.00', paymentTotal: '545.00', amountPaid: '545.00' },
      discount: { kind: 'percentage', value: '10.00', amount: '60.00' },
      tax: { kind: 'fixed', value: '5.00', amount: '5.00' },
      payments: [{ method: 'cash', amount: '545.00', refundedAmount: '0.00', refundableAmount: '545.00' }],
    }).success).toBe(true);
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: [{ ...service, queueNumbers: [] }],
    }).success).toBe(false);
  });

  it('rejects a mismatched commissioned product amount', () => {
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      lines: [{
        ...saleFixtures.completedInvoice.lines[0],
        itemType: 'product',
        productCostBasis: '50.00',
        employee: { id: 8, employeeCode: 1008, name: 'سارة علي' },
        commissionRule: 'service_default',
        commissionRate: '10.00',
        commissionAmount: '19.99',
      }],
    }).success).toBe(false);
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
    expect(saleErrorSchema.parse({
      code: 'INVOICE_NOT_FOUND', message: 'الفاتورة غير موجودة',
    }).code).toBe('INVOICE_NOT_FOUND');
    expect(saleErrorSchema.parse({
      code: 'PRICE_CHANGED', message: 'تغير سعر الخدمة',
    }).code).toBe('PRICE_CHANGED');
  });

  it('refuses a stored invoice that names no client at all', () => {
    expect(invoiceSchema.safeParse({
      ...saleFixtures.completedInvoice,
      client: { ...saleFixtures.completedInvoice.client, name: null, phone: null },
    }).success).toBe(false);
  });

  it('allows a 100% discount that settles to a zero total with no payment', () => {
    expect(invoiceTotalsSchema.safeParse({
      subtotal: '200.00', discountAmount: '200.00', taxAmount: '0.00',
      total: '0.00', paymentTotal: '0.00', amountPaid: '0.00',
      creditedAmount: '0.00', balanceDue: '0.00', settlementStatus: 'settled',
    }).success).toBe(true);
    expect(paymentBreakdownSchema.safeParse({ total: '0.00', payments: [] }).success).toBe(true);
    expect(saleQuoteSchema.safeParse({
      lines: [{
        itemType: 'service' as const, sourceId: 21, name: 'صبغة شعر', quantity: 1,
        unitPrice: '200.00', lineTotal: '200.00',
      }],
      discount: { kind: 'percentage' as const, value: '100.00', amount: '200.00' },
      tax: null,
      totals: { subtotal: '200.00', discountAmount: '200.00', taxAmount: '0.00', total: '0.00' },
    }).success).toBe(true);
    expect(completeSaleSchema.safeParse({ ...validDraft, payments: [] }).success).toBe(true);
  });
});
