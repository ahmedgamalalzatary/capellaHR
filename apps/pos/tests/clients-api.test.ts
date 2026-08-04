import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getPage: vi.fn() }));
vi.mock('../src/lib/api/client', () => ({ api: mocks }));

import { listClients } from '../src/features/clients/api/clients-api';

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
});
