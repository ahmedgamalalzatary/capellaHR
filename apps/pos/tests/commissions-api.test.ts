import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPage: vi.fn(), get: vi.fn() }));
vi.mock('../src/lib/api/client', () => ({ api: mocks }));

import { getCommissionDetail, listCommissions } from '../src/features/commissions';

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
});
