import { describe, expect, it } from 'vitest';

import {
  createCommissionService,
} from '../../src/modules/erp/commissions/index.js';

const summary = {
  employeeId: 7, employeeCode: 1007, employeeName: 'Sara', payrollMonth: '2026-08',
  earnedAmount: '300.00', reversedAmount: '50.00', netAmount: '250.00',
  paidAmount: '100.00', availableAmount: '150.00',
  invoiceLineCount: 3, reversalCount: 1,
};

describe('ERP commission service', () => {
  it('allows cashier to list and drill into commission traceability for their branch', async () => {
    const calls: unknown[] = [];
    const service = createCommissionService({
      repository: {
        list: async (...input) => { calls.push(input); return { items: [summary], total: 1 }; },
        detail: async (...input) => {
          calls.push(input);
          return { summary, entries: [], payouts: [] };
        },
        summary: async () => summary,
        createPayout: async () => ({ kind: 'employee_not_found' as const }),
      },
      resolveBranchContext: async (actor, branchId) => ({
        branchId: actor.role === 'cashier' ? actor.branchId : branchId!, accountId: actor.accountId,
        accountRole: actor.role, employeeId: null,
      }),
    });

    await expect(service.list({ role: 'cashier', accountId: 2, branchId: 1 }, {
      month: '2026-08', page: 1, pageSize: 20,
    })).resolves.toEqual({ items: [summary], total: 1 });
    await expect(service.detail({ role: 'cashier', accountId: 2, branchId: 1 }, 7, '2026-08'))
      .resolves.toEqual({ summary, entries: [], payouts: [] });
    await expect(service.list({ role: 'admin', accountId: 1 }, {
      month: '2026-08', branchId: 4, page: 1, pageSize: 20,
    })).resolves.toEqual({ items: [summary], total: 1 });
    await expect(service.detail({ role: 'admin', accountId: 1 }, 7, '2026-08', 4))
      .resolves.toEqual({ summary, entries: [], payouts: [] });
    expect(calls).toEqual([
      [1, { month: '2026-08', page: 1, pageSize: 20 }],
      [1, 7, '2026-08'],
      [4, { month: '2026-08', branchId: 4, page: 1, pageSize: 20 }],
      [4, 7, '2026-08'],
    ]);
  });

  it('publishes only an employee own monthly summary through the public reader', async () => {
    const service = createCommissionService({
      repository: {
        list: async () => ({ items: [], total: 0 }),
        detail: async () => null,
        summary: async (employeeId, month) => employeeId === 7 && month === '2026-08'
          ? summary
          : null,
        createPayout: async () => ({ kind: 'employee_not_found' as const }),
      },
      resolveBranchContext: async () => ({
        branchId: 4, accountId: 1, accountRole: 'admin', employeeId: null,
      }),
    });

    await expect(service.selfService.getMonthlySummary(7, '2026-08')).resolves.toEqual(summary);
    await expect(service.selfService.getMonthlySummary(8, '2026-08')).resolves.toBeNull();
  });

  it('lets a cashier record a partial commission payout from their own branch', async () => {
    const payout = {
      id: 1, employeeId: 7, payrollMonth: '2026-08', branchId: 4, amount: '100.00',
      expenseId: 9, reason: null, createdAt: '2026-08-10T10:00:00.000Z',
    };
    const calls: unknown[] = [];
    const service = createCommissionService({
      repository: {
        list: async () => ({ items: [], total: 0 }),
        detail: async (branchId, employeeId) => branchId === 4 && employeeId === 7
          ? { summary, entries: [], payouts: [] }
          : null,
        summary: async () => summary,
        createPayout: async (...input) => {
          calls.push(input);
          return { kind: 'success' as const, payout, summary };
        },
      },
      resolveBranchContext: async (actor, branchId) => ({
        branchId: actor.role === 'cashier' ? actor.branchId : branchId!,
        accountId: actor.accountId, accountRole: actor.role, employeeId: null,
      }),
    });

    await expect(service.createPayout(
      { role: 'cashier', accountId: 2, branchId: 4 },
      7, '2026-08', { amount: '100.00' },
    )).resolves.toEqual({ payout, summary });

    await expect(service.createPayout(
      { role: 'cashier', accountId: 2, branchId: 4 },
      8, '2026-08', { amount: '100.00' },
    )).rejects.toMatchObject({ code: 'COMMISSION_EMPLOYEE_NOT_FOUND' });

    await expect(service.createPayout(
      { role: 'admin', accountId: 1 },
      7, '2026-08', { amount: '100.00', branchId: 4, reason: 'دفعة' },
    )).resolves.toEqual({ payout, summary });
    expect(calls).toEqual([[
      {
        branchId: 4, accountId: 2, employeeId: 7, month: '2026-08', amount: '100.00',
      },
    ], [
      {
        branchId: 4, accountId: 1, employeeId: 7, month: '2026-08',
        amount: '100.00', reason: 'دفعة',
      },
    ]]);
  });

  it('maps repository payout failures to commission error codes', async () => {
    const repository = {
      list: async () => ({ items: [], total: 0 }),
      detail: async () => null,
      summary: async () => summary,
      createPayout: async () => ({ kind: 'insufficient_available' as const }),
    };
    const service = createCommissionService({
      repository,
      resolveBranchContext: async () => ({
        branchId: 4, accountId: 1, accountRole: 'admin', employeeId: null,
      }),
    });

    await expect(service.createPayout(
      { role: 'admin', accountId: 1 },
      7, '2026-08', { amount: '999.00', branchId: 4 },
    )).rejects.toMatchObject({ code: 'COMMISSION_INSUFFICIENT_AVAILABLE' });
  });
});
