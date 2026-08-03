import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPage: vi.fn() }));

vi.mock('../src/lib/api/client', () => ({
  api: { getPage: mocks.getPage },
}));

import {
  listCatalogEmployeeOptions,
  listCategories,
} from '../src/features/catalog/api/catalog-api';

describe('catalog API query serialization', () => {
  beforeEach(() => {
    mocks.getPage.mockReset();
    mocks.getPage.mockResolvedValue({ items: [], meta: { totalPages: 1 } });
  });

  it('uses the serialized URLSearchParams value without relying on size', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size');
    Object.defineProperty(URLSearchParams.prototype, 'size', { configurable: true, value: undefined });
    try {
      await listCategories({ branchId: 3, isActive: false });
    } finally {
      if (descriptor) Object.defineProperty(URLSearchParams.prototype, 'size', descriptor);
    }

    expect(mocks.getPage).toHaveBeenCalledWith('/erp/categories?branchId=3&isActive=false');
  });

  it('scopes employee option pages to the selected branch', async () => {
    await listCatalogEmployeeOptions(2, 3);

    expect(mocks.getPage).toHaveBeenCalledWith('/employees?status=active&branchId=3&page=2');
  });
});
