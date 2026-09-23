import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { invalidateErpCaches } from '../src/lib/erp-cache';

describe('ERP cache invalidation', () => {
  it('refreshes bookings after a completed sale may convert one', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateErpCaches({ invalidateQueries } as never, 'sale');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['erp-bookings'] });
  });
  it('refreshes the open drawer after a commission payout creates an expense', async () => {
    const client = new QueryClient();
    client.setQueryData(['cashier-sessions', 'summary', 7], { expenses: '0.00' });
    await invalidateErpCaches(client, 'commission');
    expect(client.getQueryState(['cashier-sessions', 'summary', 7])?.isInvalidated).toBe(true);
  });
});
