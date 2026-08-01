import { describe, expect, it } from 'vitest';

import * as contracts from './index.js';

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
    };

    expect(contracts.cashierSessionSchema.parse(session)).toEqual(session);
    expect(contracts.cashierSessionSchema.safeParse({
      ...session,
      recoveryReason: 'must only live in the audit event',
    }).success).toBe(false);
  });
});
