import { describe, expect, it } from 'vitest';

import {
  CommissionError,
  createCommissionService,
} from '../../src/modules/erp/commissions/index.js';

const summary = {
  employeeId: 7, employeeCode: 1007, employeeName: 'Sara', payrollMonth: '2026-08',
  earnedAmount: '300.00', reversedAmount: '50.00', netAmount: '250.00',
  invoiceLineCount: 3, reversalCount: 1,
};

describe('ERP commission service', () => {
  it('allows only Admin to list and drill into branch commission traceability', async () => {
    const calls: unknown[] = [];
    const service = createCommissionService({
      repository: {
        list: async (...input) => { calls.push(input); return { items: [summary], total: 1 }; },
        detail: async (...input) => {
          calls.push(input);
          return { summary, entries: [] };
        },
        summary: async () => summary,
      },
      resolveBranchContext: async (_actor, branchId) => ({
        branchId: branchId ?? 4, accountId: 1, accountRole: 'admin', employeeId: null,
      }),
    });

    await expect(service.list({ role: 'cashier', accountId: 2, employeeId: 7 }, {
      month: '2026-08', page: 1, pageSize: 20,
    })).rejects.toBeInstanceOf(CommissionError);
    await expect(service.list({ role: 'admin', accountId: 1 }, {
      month: '2026-08', branchId: 4, page: 1, pageSize: 20,
    })).resolves.toEqual({ items: [summary], total: 1 });
    await expect(service.detail({ role: 'admin', accountId: 1 }, 7, '2026-08', 4))
      .resolves.toEqual({ summary, entries: [] });
    expect(calls).toEqual([
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
      },
      resolveBranchContext: async () => ({
        branchId: 4, accountId: 1, accountRole: 'admin', employeeId: null,
      }),
    });

    await expect(service.selfService.getMonthlySummary(7, '2026-08')).resolves.toEqual(summary);
    await expect(service.selfService.getMonthlySummary(8, '2026-08')).resolves.toBeNull();
  });
});
