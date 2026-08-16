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

  it('guards future counter-sale mutations with the acting Cashier open session', async () => {
    const active = setup();
    const cashier = { role: 'cashier' as const, accountId: 8, branchId: 3 };

    await expect(active.service.requireOpenForCashier(cashier)).resolves.toEqual(session);
    expect(active.resolveBranchContext).toHaveBeenCalledWith(cashier, undefined);
    expect(active.repository.findOpenByBranch).toHaveBeenCalledWith(3);

    const absent = setup();
    absent.repository.findOpenByBranch.mockResolvedValueOnce(null);
    await expect(absent.service.requireOpenForCashier(cashier)).rejects.toMatchObject({
      code: 'ERP_CASHIER_SESSION_NOT_OPEN',
    });

    const ownedByAnotherCashier = setup();
    ownedByAnotherCashier.repository.findOpenByBranch.mockResolvedValueOnce({
      ...session,
      openedByAccountId: 9,
    });
    await expect(ownedByAnotherCashier.service.requireOpenForCashier(cashier))
      .rejects.toMatchObject({ code: 'ERP_CASHIER_SESSION_NOT_OWNER' });
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
});
