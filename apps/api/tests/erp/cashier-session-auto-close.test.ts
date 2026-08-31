import { describe, expect, it, vi } from 'vitest';

import * as sales from '../../src/modules/erp/sales/index.js';
import type { CashierSessionRepository } from '../../src/modules/erp/sales/index.js';

const openedAt = new Date('2026-08-01T06:00:00.000Z');
/** Sixteen hours and one minute after the shift opened. */
const now = new Date('2026-08-01T22:01:00.000Z');

const session = {
  id: 14,
  branchId: 3,
  branchName: 'الفرع الرئيسي',
  openedByAccountId: 8,
  openedByUsername: 'cashier.one',
  openedAt,
  closedAt: null,
  closedByAccountId: null,
  closedByUsername: null,
  autoClosedAt: null,
};

const setup = (current: typeof session | null = session) => {
  const repository = {
    open: vi.fn<CashierSessionRepository['open']>(async () => ({ kind: 'success', session })),
    findOpenByBranch: vi.fn<CashierSessionRepository['findOpenByBranch']>(async () => current),
    close: vi.fn<CashierSessionRepository['close']>(async () => ({
      kind: 'success' as const,
      session: { ...session, closedAt: now, closedByAccountId: 8, closedByUsername: 'cashier.one' },
    })),
    recoveryClose: vi.fn<CashierSessionRepository['recoveryClose']>(async () => ({
      kind: 'success' as const,
      session: { ...session, closedAt: now, closedByAccountId: 1, closedByUsername: 'admin' },
    })),
    autoCloseExpired: vi.fn(async () => []),
    list: vi.fn(async () => ({ items: [], total: 0 })),
    findMoneyById: vi.fn(async () => null),
    readReportAccounting: vi.fn(async () => ({
      sales: {
        gross: '0.00', returns: '0.00', total: '0.00',
        discount: '0.00', tax: '0.00', net: '0.00',
      },
      expenses: '0.00', collectedPayments: '0.00', creditSales: '0.00',
    })),
    listInvoices: vi.fn(async () => []),
  };
  const resolveBranchContext = vi.fn(async (
    actor: { role: 'admin' | 'cashier'; accountId: number },
    branchId?: number,
  ) => ({
    accountId: actor.accountId,
    accountRole: actor.role,
    branchId: branchId ?? 3,
    employeeId: null,
  }));
  const createService = Reflect.get(sales, 'createCashierSessionService');
  const service = createService({ repository, resolveBranchContext, now: () => now });
  return { repository, service };
};

describe('ERP Cashier-session automatic close', () => {
  it('publishes the sixteen-hour shift limit', () => {
    expect(Reflect.get(sales, 'CASHIER_SESSION_MAX_DURATION_MS')).toBe(16 * 60 * 60_000);
  });

  it('ends every shift that passed the limit, timestamped at the moment it expired', async () => {
    const { repository, service } = setup();

    await service.closeExpired();

    expect(repository.autoCloseExpired).toHaveBeenCalledWith({
      openedBefore: new Date(now.getTime() - 16 * 60 * 60_000),
    });
  });

  it('sweeps expired shifts before reporting the current one', async () => {
    const { repository, service } = setup();

    await service.current({ role: 'cashier', accountId: 8, branchId: 3 });

    expect(repository.autoCloseExpired).toHaveBeenCalled();
    expect(repository.autoCloseExpired.mock.invocationCallOrder[0]!)
      .toBeLessThan(repository.findOpenByBranch.mock.invocationCallOrder[0]!);
  });

  it('sweeps expired shifts before opening a new one so the till is never blocked', async () => {
    const { repository, service } = setup();

    await service.open({ role: 'cashier', accountId: 8, branchId: 3 });

    expect(repository.autoCloseExpired).toHaveBeenCalled();
    expect(repository.autoCloseExpired.mock.invocationCallOrder[0]!)
      .toBeLessThan(repository.open.mock.invocationCallOrder[0]!);
  });

  it('sweeps expired shifts before closing one by hand', async () => {
    const { repository, service } = setup();

    await service.close({ role: 'cashier', accountId: 8, branchId: 3 });

    expect(repository.autoCloseExpired.mock.invocationCallOrder[0]!)
      .toBeLessThan(repository.close.mock.invocationCallOrder[0]!);
  });
});
