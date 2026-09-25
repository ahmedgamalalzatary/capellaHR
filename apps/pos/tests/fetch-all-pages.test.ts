import { describe, expect, it, vi } from 'vitest';

import { fetchAllPages } from '../src/lib/api/fetch-all';

describe('fetchAllPages', () => {
  it('returns every item once when the same record appears on more than one page', async () => {
    const duplicated = { id: 3, name: 'مورد النيل' };
    const fetchPage = vi.fn(async (page: number) => (
      page === 1
        ? { items: [duplicated], meta: { totalPages: 2 } }
        : { items: [duplicated], meta: { totalPages: 2 } }
    ));

    await expect(fetchAllPages(fetchPage)).resolves.toEqual([duplicated]);
  });

  it('keeps distinct items from every page in order', async () => {
    const fetchPage = vi.fn(async (page: number) => (
      page === 1
        ? { items: [{ id: 1 }, { id: 2 }], meta: { totalPages: 2 } }
        : { items: [{ id: 3 }], meta: { totalPages: 2 } }
    ));

    await expect(fetchAllPages(fetchPage)).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('keeps rows that carry no id of their own, using the caller identity', async () => {
    const firstBalance = { productId: 9, consumableQuantity: '1.000' };
    const secondBalance = { productId: 10, consumableQuantity: '2.000' };
    const fetchPage = vi.fn(async (page: number) => (
      page === 1
        ? { items: [firstBalance], meta: { totalPages: 2 } }
        : { items: [secondBalance], meta: { totalPages: 2 } }
    ));

    await expect(
      fetchAllPages(fetchPage, (balance) => balance.productId),
    ).resolves.toEqual([firstBalance, secondBalance]);
  });
});
