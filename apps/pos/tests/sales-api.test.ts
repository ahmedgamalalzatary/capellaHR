import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn(), getPage: vi.fn() }));

vi.mock('../src/lib/api/client', () => ({ api: mocks }));

import {
  completeSale,
  listClientVisits,
  quoteSale,
} from '../src/features/sales/api/sales-api';

describe('sales API', () => {
  beforeEach(() => {
    mocks.post.mockReset().mockResolvedValue({});
    mocks.getPage.mockReset().mockResolvedValue({ items: [], meta: {} });
  });

  it('posts quote and completion requests to the sales aggregate endpoints', async () => {
    const quote = { lines: [{ itemType: 'service' as const, serviceId: 21, quantity: 1 }] };
    await quoteSale(quote);
    expect(mocks.post).toHaveBeenCalledWith('/erp/sales/quote', quote);

    const complete = {
      clientId: 5,
      assignedEmployeeId: 8,
      cashierSessionId: 13,
      idempotencyKey: crypto.randomUUID(),
      lines: quote.lines,
      payments: [{ method: 'cash' as const, amount: '200.00' }],
    };
    await completeSale(complete);
    expect(mocks.post).toHaveBeenCalledWith('/erp/sales', complete);
  });

  it('serializes branch-scoped client visit pagination', async () => {
    await listClientVisits(5, { branchId: 2, page: 3, pageSize: 10 });
    expect(mocks.getPage).toHaveBeenCalledWith(
      '/erp/sales/clients/5/visits?branchId=2&page=3&pageSize=10',
    );
  });
});
