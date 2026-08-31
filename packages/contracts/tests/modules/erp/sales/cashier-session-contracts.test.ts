import { describe, expect, it } from 'vitest';

import * as contracts from '../../../../src/modules/erp/sales/index.js';

describe('ERP Cashier-session contracts', () => {
  it('accepts the optional Admin branch selector and rejects invalid branch identifiers', () => {
    expect(contracts.cashierSessionCurrentQuerySchema.parse({})).toEqual({});
    expect(contracts.cashierSessionCurrentQuerySchema.parse({ branchId: '7' }))
      .toEqual({ branchId: 7 });
    expect(contracts.cashierSessionCurrentQuerySchema.safeParse({ branchId: '0' }).success)
      .toBe(false);
  });

  it('requires a trimmed recovery reason and caps it at 1000 characters', () => {
    expect(contracts.recoveryCloseCashierSessionSchema.parse({ reason: '  انقطاع الجهاز  ' }))
      .toEqual({ reason: 'انقطاع الجهاز' });
    expect(contracts.recoveryCloseCashierSessionSchema.safeParse({ reason: '   ' }).success)
      .toBe(false);
    const overlong = contracts.recoveryCloseCashierSessionSchema.safeParse({ reason: 'x'.repeat(1001) });
    expect(overlong.success).toBe(false);
    if (!overlong.success) expect(overlong.error.issues[0]?.message).toBe('سبب الإغلاق الاستثنائي طويل جدًا');
    expect(contracts.recoveryCloseCashierSessionSchema.safeParse({
      reason: 'سبب',
      closedByAccountId: 99,
    }).success).toBe(false);
  });

  it('parses session identifiers at the HTTP boundary', () => {
    expect(contracts.cashierSessionParamsSchema.parse({ sessionId: '12' }))
      .toEqual({ sessionId: 12 });
    expect(contracts.cashierSessionParamsSchema.safeParse({ sessionId: '-1' }).success)
      .toBe(false);
  });

  it('defines a secret-safe Cashier-session response', () => {
    const session = {
      id: 12,
      branchId: 3,
      branchName: 'الفرع الرئيسي',
      openedByAccountId: 8,
      openedByUsername: 'cashier.one',
      openedAt: '2026-08-01T09:00:00.000Z',
      closedAt: null,
      closedByAccountId: null,
      closedByUsername: null,
      autoClosedAt: null,
    };

    expect(contracts.cashierSessionSchema.parse(session)).toEqual(session);
    // A shift the system ended names no closing account, only the instant.
    expect(contracts.cashierSessionSchema.parse({
      ...session,
      closedAt: '2026-08-02T01:00:00.000Z',
      autoClosedAt: '2026-08-02T01:00:00.000Z',
    })).toMatchObject({ closedByAccountId: null, autoClosedAt: '2026-08-02T01:00:00.000Z' });
    expect(contracts.cashierSessionSchema.safeParse({
      ...session,
      recoveryReason: 'must only live in the audit event',
    }).success).toBe(false);
  });

  it('pages the shift history and keeps the Admin branch selector optional', () => {
    expect(contracts.cashierSessionListQuerySchema.parse({}))
      .toEqual({ page: 1, pageSize: 20 });
    expect(contracts.cashierSessionListQuerySchema.parse({ page: '3', branchId: '7' }))
      .toEqual({ page: 3, pageSize: 20, branchId: 7 });
    expect(contracts.cashierSessionListQuerySchema.safeParse({ status: 'open' }).success)
      .toBe(false);
  });

  it('summarises a shift by money taken and handed back per method', () => {
    const summary = {
      id: 12,
      branchId: 3,
      branchName: 'الفرع الرئيسي',
      openedByAccountId: 8,
      openedByUsername: 'cashier.one',
      openedAt: '2026-08-01T09:00:00.000Z',
      closedAt: '2026-08-01T17:00:00.000Z',
      closedByAccountId: 8,
      closedByUsername: 'cashier.one',
      autoClosedAt: null,
      durationMinutes: 480,
      saleCount: 2,
      taken: { cash: '300.00', visa: '100.00', instapay: '0.00', vodafone_cash: '0.00' },
      refunded: { cash: '50.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
      takenTotal: '400.00',
      refundedTotal: '50.00',
      net: '350.00',
    };

    expect(contracts.cashierSessionSummarySchema.parse(summary)).toEqual(summary);
    // A shift still running has run for a while but has not ended.
    expect(contracts.cashierSessionSummarySchema.parse({
      ...summary, closedAt: null, closedByAccountId: null, closedByUsername: null,
    })).toMatchObject({ closedAt: null, durationMinutes: 480 });
    // Handing back more than was taken is a real, if unhappy, shift.
    expect(contracts.cashierSessionSummarySchema.parse({
      ...summary, refunded: { ...summary.refunded, cash: '400.25' },
      refundedTotal: '400.25', net: '-0.25',
    })).toMatchObject({ net: '-0.25' });
    expect(contracts.cashierSessionSummarySchema.parse({
      ...summary, refunded: { ...summary.refunded, cash: '450.00' },
      refundedTotal: '450.00', net: '-50.00',
    })).toMatchObject({ net: '-50.00' });
    // The net must be exactly what was taken less what was handed back.
    expect(contracts.cashierSessionSummarySchema.safeParse({ ...summary, net: '400.00' }).success)
      .toBe(false);
    // Every method must be accounted for, even the ones nobody used.
    expect(contracts.cashierSessionSummarySchema.safeParse({
      ...summary, taken: { cash: '300.00', visa: '100.00' },
    }).success).toBe(false);
  });

  it('lists the sales behind a shift alongside its summary', () => {
    const detail = {
      summary: {
        id: 12,
        branchId: 3,
        branchName: 'الفرع الرئيسي',
        openedByAccountId: 8,
        openedByUsername: 'cashier.one',
        openedAt: '2026-08-01T09:00:00.000Z',
        closedAt: null,
        closedByAccountId: null,
        closedByUsername: null,
        autoClosedAt: null,
        durationMinutes: 60,
        saleCount: 1,
        taken: { cash: '185.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
        refunded: { cash: '0.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
        takenTotal: '185.00',
        refundedTotal: '0.00',
        net: '185.00',
      },
      invoices: [{
        id: 41,
        invoiceNumber: 'INV-2026.08.01-12.00-3',
        status: 'completed' as const,
        client: { id: 5, name: 'عميل', phone: null },
        total: '185.00',
        // What this shift took on this invoice, which is not the invoice total
        // once an invoice can be paid across two shifts.
        takenInShift: '185.00',
        refundedInShift: '0.00',
        soldAt: '2026-08-01T12:00:00.000Z',
      }],
    };

    expect(contracts.cashierSessionDetailSchema.parse(detail)).toEqual(detail);
    expect(contracts.cashierSessionDetailSchema.safeParse({ ...detail, invoices: [] }).success)
      .toBe(true);
  });

  it('defines an internally consistent full shift-ending report', () => {
    const report = {
      summary: {
        id: 12,
        branchId: 3,
        branchName: 'الفرع الرئيسي',
        openedByAccountId: 8,
        openedByUsername: 'cashier.one',
        openedAt: '2026-08-01T09:00:00.000Z',
        closedAt: '2026-08-01T17:00:00.000Z',
        closedByAccountId: 8,
        closedByUsername: 'cashier.one',
        autoClosedAt: null,
        durationMinutes: 480,
        saleCount: 2,
        taken: { cash: '300.00', visa: '100.00', instapay: '0.00', vodafone_cash: '0.00' },
        refunded: { cash: '50.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
        takenTotal: '400.00',
        refundedTotal: '50.00',
        net: '350.00',
      },
      sales: {
        gross: '500.00',
        returns: '50.00',
        total: '450.00',
        discount: '25.00',
        tax: '5.00',
        net: '430.00',
      },
      expenses: '30.00',
      collectedPayments: '20.00',
      creditSales: '100.00',
      netByMethod: {
        cash: '250.00', visa: '100.00', instapay: '0.00', vodafone_cash: '0.00',
      },
    };

    expect(contracts.cashierSessionReportSchema.parse(report)).toEqual(report);
    expect(contracts.cashierSessionReportSchema.safeParse({
      ...report,
      sales: { ...report.sales, net: '431.00' },
    }).success).toBe(false);
    expect(contracts.cashierSessionReportSchema.safeParse({
      ...report,
      netByMethod: { cash: '350.00' },
    }).success).toBe(false);
  });
});
