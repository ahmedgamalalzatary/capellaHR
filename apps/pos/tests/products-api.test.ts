import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPage: vi.fn() }));

vi.mock('../src/lib/api/client', () => ({ api: { getPage: mocks.getPage } }));

import { listAllProducts, listProducts, listStockMovements } from '../src/features/products/api/products-api';

describe('products API', () => {
  beforeEach(() => {
    mocks.getPage.mockReset();
    mocks.getPage.mockResolvedValue({ items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } });
  });

  it('serializes every filter without relying on URLSearchParams.size', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size');
    Object.defineProperty(URLSearchParams.prototype, 'size', { configurable: true, value: undefined });
    try {
      await listProducts({ branchId: 3, isActive: false });
      await listStockMovements({ branchId: 3, reason: 'wastage' });
    } finally {
      if (descriptor) Object.defineProperty(URLSearchParams.prototype, 'size', descriptor);
    }

    expect(mocks.getPage).toHaveBeenNthCalledWith(1, '/erp/products?branchId=3&isActive=false');
    expect(mocks.getPage).toHaveBeenNthCalledWith(2, '/erp/products/movements?branchId=3&reason=wastage');
  });

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
