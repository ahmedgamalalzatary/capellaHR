import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getPage: vi.fn() }));
vi.mock('../src/lib/api/client', () => ({ api: { getPage: mocks.getPage } }));
import { listAllSuppliers } from '../src/features/suppliers/api/suppliers-api';

describe('suppliers API', () => {
  beforeEach(() => mocks.getPage.mockReset());
  it('loads every supplier page for complete lifecycle and history controls', async () => {
    mocks.getPage.mockResolvedValueOnce({ items: [{ id: 1 }], meta: { page: 1, pageSize: 100, total: 101, totalPages: 2 } }).mockResolvedValueOnce({ items: [{ id: 101 }], meta: { page: 2, pageSize: 100, total: 101, totalPages: 2 } });
    expect((await listAllSuppliers({ branchId: 2 })).items).toEqual([{ id: 1 }, { id: 101 }]);
    expect(mocks.getPage).toHaveBeenNthCalledWith(2, '/erp/suppliers?branchId=2&page=2&pageSize=100');
  });
});
