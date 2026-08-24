import { describe, expect, it, vi } from 'vitest';

import { invalidateErpCaches } from '../src/lib/erp-cache';

describe('ERP cache invalidation', () => {
  it('refreshes bookings after a completed sale may convert one', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateErpCaches({ invalidateQueries } as never, 'sale');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['erp-bookings'] });
  });
});
