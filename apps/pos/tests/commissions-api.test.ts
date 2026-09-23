import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPage: vi.fn(), get: vi.fn(), post: vi.fn() }));
vi.mock('../src/lib/api/client', () => ({ api: mocks }));

import { createCommissionPayout, getCommissionDetail, listCommissions } from '../src/features/commissions';

beforeEach(() => vi.clearAllMocks());

describe('commissions API', () => {
  it('serializes branch, month, employee and pagination filters', async () => {
    mocks.getPage.mockResolvedValue({ items: [], meta: {} });

    await listCommissions({ month: '2026-08', branchId: 2, employeeId: 7, page: 3, pageSize: 20 });

    expect(mocks.getPage).toHaveBeenCalledWith(
      '/erp/commissions?month=2026-08&branchId=2&employeeId=7&page=3&pageSize=20',
    );
  });

  it('reads one employee month with its branch-scoped trace', async () => {
    mocks.get.mockResolvedValue({});

    await getCommissionDetail(7, '2026-08', 2);

    expect(mocks.get).toHaveBeenCalledWith('/erp/commissions/7/2026-08?branchId=2');
  });

  it('omits branch selection for a cashier-owned commission request', async () => {
    mocks.getPage.mockResolvedValue({ items: [], meta: {} });
    mocks.get.mockResolvedValue({});
    await listCommissions({ month: '2026-08', page: 1, pageSize: 20 });
    await getCommissionDetail(7, '2026-08');
    expect(mocks.getPage).toHaveBeenCalledWith('/erp/commissions?month=2026-08&page=1&pageSize=20');
    expect(mocks.get).toHaveBeenCalledWith('/erp/commissions/7/2026-08');
  });

  it('posts a mid-month payout with amount, branch and reason', async () => {
    mocks.post.mockResolvedValue({});

    await createCommissionPayout(7, '2026-08', {
      amount: '50.00', branchId: 2, reason: 'دفعة جزئية',
    });

    expect(mocks.post).toHaveBeenCalledWith(
      '/erp/commissions/7/2026-08/payouts',
      { amount: '50.00', branchId: 2, reason: 'دفعة جزئية' },
    );
  });
});
