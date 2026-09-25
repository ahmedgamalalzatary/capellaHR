import { describe, expect, it, vi } from 'vitest';

import { fetchAllPages } from '../src/lib/api/fetch-all';

describe('fetchAllPages', () => {
  it('returns every item once when the same record appears on more than one page', async () => {
    const duplicated = { id: 3, name: 'فرع thrice' };
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
    const first = { productId: 9, name: 'صفحة واحدة' };
    const second = { productId: 10, name: 'صفحة ثانية' };
    const fetchPage = vi.fn(async (page: number) => (
      page === 1
        ? { items: [first], meta: { totalPages: 2 } }
        : { items: [second], meta: { totalPages: 2 } }
    ));

    await expect(
      fetchAllPages(fetchPage, (row) => row.productId),
    ).resolves.toEqual([first, second]);
  });
});
