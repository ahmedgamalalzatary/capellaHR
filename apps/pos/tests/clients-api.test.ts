import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPage: vi.fn() }));
vi.mock('../src/lib/api/client', () => ({ api: mocks }));

import { listClientDebtInvoices, listClients } from '../src/features/clients/api/clients-api';

describe('clients API query serialization', () => {
  beforeEach(() => mocks.getPage.mockReset().mockResolvedValue({ items: [], meta: {} }));

  it('uses the serialized query value without relying on URLSearchParams.size', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size');
    Object.defineProperty(URLSearchParams.prototype, 'size', { configurable: true, value: undefined });
    try {
      await listClients({ branchId: 3, search: '010' });
    } finally {
      if (descriptor) Object.defineProperty(URLSearchParams.prototype, 'size', descriptor);
      else delete (URLSearchParams.prototype as { size?: number }).size;
    }
    expect(mocks.getPage).toHaveBeenCalledWith('/erp/clients?branchId=3&search=010');
  });

  it('loads every page of the selected client open invoices', async () => {
    mocks.getPage
      .mockResolvedValueOnce({ items: [{ id: 1 }], meta: { page: 1, totalPages: 2 } })
      .mockResolvedValueOnce({ items: [{ id: 2 }], meta: { page: 2, totalPages: 2 } });

    const result = await listClientDebtInvoices(42, 3);

    expect(mocks.getPage).toHaveBeenNthCalledWith(1,
      '/erp/sales?clientId=42&branchId=3&settlementStatus=open&orderBy=soldAt&orderDir=desc&page=1&pageSize=100',
    );
    expect(mocks.getPage).toHaveBeenNthCalledWith(2,
      '/erp/sales?clientId=42&branchId=3&settlementStatus=open&orderBy=soldAt&orderDir=desc&page=2&pageSize=100',
    );
    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
