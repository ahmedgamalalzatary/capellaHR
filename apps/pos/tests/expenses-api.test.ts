import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPage: vi.fn(), get: vi.fn(), post: vi.fn() }));
vi.mock('../src/lib/api/client', () => ({ api: mocks }));

import { correctExpense, createExpense, getExpense, listExpenses } from '../src/features/expenses/api/expenses-api';

beforeEach(() => vi.clearAllMocks());
describe('expenses API', () => {
  it('serializes pagination and filters', async () => {
    mocks.getPage.mockResolvedValue({ items: [], meta: {} });
    await listExpenses({ branchId: 2, search: 'كهرباء', fromDate: '2026-08-01', toDate: '2026-08-31', status: 'active', page: 2, pageSize: 20 });
    expect(mocks.getPage).toHaveBeenCalledWith(`/erp/expenses?branchId=2&search=${encodeURIComponent('كهرباء')}&fromDate=2026-08-01&toDate=2026-08-31&status=active&page=2&pageSize=20`);
  });
  it('uses explicit create, read and correction endpoints', async () => {
    const input = { branchId: 2, name: 'كهرباء', amount: '10', expenseDate: '2026-08-05', description: 'x' };
    await createExpense(input); await getExpense(8, 2); await correctExpense(8, { ...input, reason: 'x' });
    expect(mocks.post).toHaveBeenNthCalledWith(1, '/erp/expenses', input);
    expect(mocks.get).toHaveBeenCalledWith('/erp/expenses/8?branchId=2');
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/erp/expenses/8/corrections', { ...input, reason: 'x' });
  });
});
