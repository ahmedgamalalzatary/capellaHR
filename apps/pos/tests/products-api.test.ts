import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPage: vi.fn() }));

vi.mock('../src/lib/api/client', () => ({ api: { getPage: mocks.getPage } }));

import { listAllProducts } from '../src/features/products/api/products-api';

describe('products API', () => {
  beforeEach(() => mocks.getPage.mockReset());

  it('loads every product page so low-stock administration cannot truncate the catalog', async () => {
    mocks.getPage
      .mockResolvedValueOnce({ items: [{ id: 1 }], meta: { page: 1, pageSize: 100, total: 101, totalPages: 2 } })
      .mockResolvedValueOnce({ items: [{ id: 101 }], meta: { page: 2, pageSize: 100, total: 101, totalPages: 2 } });

    const result = await listAllProducts({ branchId: 3, lowStock: true });

    expect(mocks.getPage).toHaveBeenNthCalledWith(1, '/erp/products?branchId=3&lowStock=true&page=1&pageSize=100');
    expect(mocks.getPage).toHaveBeenNthCalledWith(2, '/erp/products?branchId=3&lowStock=true&page=2&pageSize=100');
    expect(result.items).toEqual([{ id: 1 }, { id: 101 }]);
  });
});
