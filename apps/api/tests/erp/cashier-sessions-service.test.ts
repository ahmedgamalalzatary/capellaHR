import { describe, expect, it, vi } from 'vitest';

import * as sales from '../../src/modules/erp/sales/index.js';
import type { CashierSessionRepository } from '../../src/modules/erp/sales/index.js';

const now = new Date('2026-08-01T09:30:00.000Z');
const session = {
  id: 14,
  branchId: 3,
  branchName: 'الفرع الرئيسي',
  openedByAccountId: 8,
  openedByUsername: 'cashier.one',
  openedAt: now,
  closedAt: null,
  closedByAccountId: null,
  closedByUsername: null,
  autoClosedAt: null,
};

const noMoney = { cash: '0.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' };
const money = {
  ...session,
  saleCount: 2,
  taken: { ...noMoney, cash: '400.00' },
  refunded: { ...noMoney, cash: '50.00' },
  takenTotal: '400.00',
  refundedTotal: '50.00',
  net: '350.00',
};

const setup = () => {
  const repository = {
    open: vi.fn<CashierSessionRepository['open']>(async () => ({
      kind: 'success',
      session,
    })),
    findOpenByBranch: vi.fn<CashierSessionRepository['findOpenByBranch']>(async () => session),
    close: vi.fn<CashierSessionRepository['close']>(async () => ({
      kind: 'success' as const,
      session: {
        ...session,
        closedAt: now,
        closedByAccountId: 8,
        closedByUsername: 'cashier.one',
      },
    })),
    recoveryClose: vi.fn<CashierSessionRepository['recoveryClose']>(async () => ({
      kind: 'success' as const,
      session: {
        ...session,
        closedAt: now,
        closedByAccountId: 1,
        closedByUsername: 'admin@capella.test',
      },
    })),
    autoCloseExpired: vi.fn<CashierSessionRepository['autoCloseExpired']>(async () => []),
    list: vi.fn<CashierSessionRepository['list']>(async () => ({ items: [money], total: 1 })),
    findMoneyById: vi.fn<CashierSessionRepository['findMoneyById']>(async () => money),
    readReportAccounting: vi.fn<CashierSessionRepository['readReportAccounting']>(async () => ({
      sales: {
        gross: '500.00', returns: '50.00', total: '450.00',
        discount: '25.00', tax: '5.00', net: '430.00',
      },
      expenses: '30.00',
      collectedPayments: '20.00',
      creditSales: '100.00',
    })),
    listInvoices: vi.fn<CashierSessionRepository['listInvoices']>(async () => []),
  };
  const resolveBranchContext = vi.fn(async (actor: { role: 'admin' | 'cashier'; accountId: number }, branchId?: number) => ({
    accountId: actor.accountId,
    accountRole: actor.role,
    branchId: branchId ?? 3,
    employeeId: null,
  }));
  const createService = Reflect.get(sales, 'createCashierSessionService');
  const service = createService({ repository, resolveBranchContext, now: () => now });
  return { repository, resolveBranchContext, service };
};

describe('ERP Cashier-session service', () => {
  it('publishes the Cashier-session service through the sales module boundary', () => {
    expect(Reflect.get(sales, 'createCashierSessionService')).toBeTypeOf('function');
  });

  it('opens a session only for the Cashier branch derived by the ERP boundary', async () => {
    const { repository, resolveBranchContext, service } = setup();
    const actor = { role: 'cashier' as const, accountId: 8, branchId: 3 };

    await expect(service.open(actor)).resolves.toEqual(session);
    expect(resolveBranchContext).toHaveBeenCalledWith(actor, undefined);
    expect(repository.open).toHaveBeenCalledWith({
      branchId: 3,
      openedByAccountId: 8,
      openedAt: now,
    });
  });

  it('rejects Admin normal opening and closing', async () => {
    const { repository, service } = setup();
    const admin = { role: 'admin' as const, accountId: 1 };

    await expect(service.open(admin)).rejects.toMatchObject({
      code: 'ERP_CASHIER_SESSION_CASHIER_REQUIRED',
    });
    await expect(service.close(admin)).rejects.toMatchObject({
      code: 'ERP_CASHIER_SESSION_CASHIER_REQUIRED',
    });
    expect(repository.open).not.toHaveBeenCalled();
    expect(repository.close).not.toHaveBeenCalled();
  });

  it('returns the open session for a Cashier branch or an Admin-selected branch', async () => {
    const { repository, resolveBranchContext, service } = setup();
    const cashier = { role: 'cashier' as const, accountId: 8, branchId: 3 };
    const admin = { role: 'admin' as const, accountId: 1 };

    await expect(service.current(cashier)).resolves.toEqual(session);
    await expect(service.current(admin, 4)).resolves.toEqual(session);
    expect(resolveBranchContext).toHaveBeenNthCalledWith(1, cashier, undefined);
    expect(resolveBranchContext).toHaveBeenNthCalledWith(2, admin, 4);
    expect(repository.findOpenByBranch).toHaveBeenNthCalledWith(1, 3);
    expect(repository.findOpenByBranch).toHaveBeenNthCalledWith(2, 4);
  });

  it('maps a concurrent second open to a stable conflict', async () => {
    const { repository, service } = setup();
    repository.open.mockResolvedValueOnce({ kind: 'already_open', session });

    await expect(service.open({ role: 'cashier', accountId: 8, branchId: 3 }))
      .rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_ALREADY_OPEN' });
  });

  it('closes only the session owned by the acting Cashier', async () => {
    const { repository, service } = setup();

    await service.close({ role: 'cashier', accountId: 8, branchId: 3 });

    expect(repository.close).toHaveBeenCalledWith({
      branchId: 3,
      closedByAccountId: 8,
      closedAt: now,
    });
  });

  it('returns stable close errors for no open session and another Cashier owner', async () => {
    const first = setup();
    first.repository.close.mockResolvedValueOnce({ kind: 'not_open' });
    await expect(first.service.close({ role: 'cashier', accountId: 8, branchId: 3 }))
      .rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_NOT_OPEN' });

    const second = setup();
    second.repository.close.mockResolvedValueOnce({ kind: 'not_owner', session });
    await expect(second.service.close({ role: 'cashier', accountId: 9, branchId: 3 }))
      .rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_NOT_OWNER' });
  });

  it('allows only an Admin to recovery-close with the required audited reason', async () => {
    const { repository, service } = setup();

    await expect(service.recoveryClose(
      { role: 'admin', accountId: 1 },
      14,
      '  انقطاع جهاز الكاشير  ',
    )).resolves.toMatchObject({ closedByAccountId: 1 });
    expect(repository.recoveryClose).toHaveBeenCalledWith({
      sessionId: 14,
      closedByAccountId: 1,
      closedAt: now,
      reason: 'انقطاع جهاز الكاشير',
    });

    await expect(service.recoveryClose(
      { role: 'cashier', accountId: 8, branchId: 3 },
      14,
      'سبب',
    )).rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_ADMIN_REQUIRED' });
  });

  it('enforces the mandatory recovery reason inside the business service', async () => {
    const blank = setup();
    await expect(blank.service.recoveryClose(
      { role: 'admin', accountId: 1 }, 14, '   ',
    )).rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_INVALID_RECOVERY_REASON' });
    expect(blank.repository.recoveryClose).not.toHaveBeenCalled();

    const overlong = setup();
    await expect(overlong.service.recoveryClose(
      { role: 'admin', accountId: 1 }, 14, 'س'.repeat(1001),
    )).rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_INVALID_RECOVERY_REASON' });
    expect(overlong.repository.recoveryClose).not.toHaveBeenCalled();
  });

  it('distinguishes missing and already-closed recovery targets', async () => {
    const missing = setup();
    missing.repository.recoveryClose.mockResolvedValueOnce({ kind: 'not_found' });
    await expect(missing.service.recoveryClose(
      { role: 'admin', accountId: 1 }, 404, 'سبب',
    )).rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_NOT_FOUND' });

    const closed = setup();
    closed.repository.recoveryClose.mockResolvedValueOnce({ kind: 'already_closed', session });
    await expect(closed.service.recoveryClose(
      { role: 'admin', accountId: 1 }, 14, 'سبب',
    )).rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_ALREADY_CLOSED' });
  });

  it('measures an open shift up to now and a closed one up to its close', async () => {
    const { repository, service } = setup();
    repository.findMoneyById.mockResolvedValue({
      ...money,
      openedAt: new Date('2026-08-01T08:00:00.000Z'),
    });

    // Open at 08:00, read at 09:30: an hour and a half so far.
    await expect(service.summary({ role: 'admin', accountId: 1 }, 14))
      .resolves.toMatchObject({ durationMinutes: 90, net: '350.00' });

    repository.findMoneyById.mockResolvedValue({
      ...money,
      openedAt: new Date('2026-08-01T08:00:00.000Z'),
      closedAt: new Date('2026-08-01T09:00:00.000Z'),
    });
    await expect(service.summary({ role: 'admin', accountId: 1 }, 14))
      .resolves.toMatchObject({ durationMinutes: 60 });
  });

  it('ends a stale shift before reporting on it', async () => {
    const { repository, service } = setup();

    await service.list({ role: 'admin', accountId: 1 }, { page: 1, pageSize: 20 });

    expect(repository.autoCloseExpired).toHaveBeenCalled();
  });

  it('lets an Admin read any branch and a Cashier only their own shifts', async () => {
    const { repository, service } = setup();

    await service.list({ role: 'admin', accountId: 1 }, { page: 1, pageSize: 20, branchId: 9 });
    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({
      branchId: 9, openedByAccountId: undefined,
    }));

    await service.list({ role: 'cashier', accountId: 8, branchId: 3 }, { page: 1, pageSize: 20 });
    expect(repository.list).toHaveBeenLastCalledWith(expect.objectContaining({
      branchId: 3, openedByAccountId: 8,
    }));
  });

  it('refuses a Cashier the shift of another till and the shift of another branch', async () => {
    const { repository, service } = setup();
    repository.findMoneyById.mockResolvedValue({ ...money, openedByAccountId: 99 });

    await expect(service.detail({ role: 'cashier', accountId: 8, branchId: 3 }, 14))
      .rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_NOT_OWNER' });

    repository.findMoneyById.mockResolvedValue({ ...money, branchId: 4 });
    await expect(service.detail({ role: 'cashier', accountId: 8, branchId: 3 }, 14))
      .rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_NOT_FOUND' });
  });

  it('reports a shift that does not exist as missing', async () => {
    const { repository, service } = setup();
    repository.findMoneyById.mockResolvedValue(null);

    await expect(service.detail({ role: 'admin', accountId: 1 }, 14))
      .rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_NOT_FOUND' });
  });

  it('hands the detail its shift summary and the sales behind it', async () => {
    const { repository, service } = setup();
    const invoice = {
      id: 41,
      invoiceNumber: 'INV-2026.08.01-12.00-3',
      status: 'completed' as const,
      client: { id: 5, name: 'عميل', phone: null },
      total: '185.00',
      takenInShift: '185.00',
      refundedInShift: '0.00',
      soldAt: now,
    };
    repository.listInvoices.mockResolvedValue([invoice]);

    await expect(service.detail({ role: 'admin', accountId: 1 }, 14)).resolves.toEqual({
      summary: expect.objectContaining({ id: 14, net: '350.00' }),
      invoices: [invoice],
    });
    expect(repository.listInvoices).toHaveBeenCalledWith(14);
  });

  it('blocks manual shift close while sold services still need completion reports', async () => {
    const { repository, service } = setup();
    repository.close.mockResolvedValueOnce({ kind: 'unfinished_services', count: 3 });
    await expect(service.close({ role: 'cashier', accountId: 8, branchId: 3 }))
      .rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_UNFINISHED_SERVICES' });
  });

  it('builds the full report after applying the same shift ownership check', async () => {
    const { repository, service } = setup();
    repository.findMoneyById.mockResolvedValue({ ...money, closedAt: now });

    await expect(service.report({ role: 'cashier', accountId: 8, branchId: 3 }, 14))
      .resolves.toMatchObject({
        summary: { id: 14, net: '350.00' },
        sales: { gross: '500.00', returns: '50.00', net: '430.00' },
        expenses: '30.00',
        collectedPayments: '20.00',
        creditSales: '100.00',
        netByMethod: {
          cash: '350.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00',
        },
      });
    expect(repository.readReportAccounting).toHaveBeenCalledWith({
      sessionId: 14,
      branchId: 3,
      openedAt: now,
      closedAt: now,
    });

    repository.findMoneyById.mockResolvedValueOnce({ ...money, openedByAccountId: 99 });
    await expect(service.report({ role: 'cashier', accountId: 8, branchId: 3 }, 14))
      .rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_NOT_OWNER' });
  });

  it('rejects reporting an open shift before reading its accounting', async () => {
    const { repository, service } = setup();
    repository.findMoneyById.mockResolvedValue({ ...money, closedAt: null });

    await expect(service.report({ role: 'cashier', accountId: 8, branchId: 3 }, 14))
      .rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_NOT_CLOSED' });
    expect(repository.readReportAccounting).not.toHaveBeenCalled();
  });
});
