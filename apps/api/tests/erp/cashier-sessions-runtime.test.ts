import { describe, expect, it, vi } from 'vitest';

import { createCashierSessionSweeper } from '../../src/modules/erp/sales/cashier-sessions-runtime.js';

describe('cashier shift sweeper', () => {
  it('ends every shift already past its sixteen hours', async () => {
    const autoCloseExpired = vi.fn(async () => [{ id: 3 }, { id: 9 }]);
    const now = new Date('2026-08-02T00:00:00.000Z');
    const sweep = createCashierSessionSweeper({
      repository: { autoCloseExpired } as never,
      now: () => now,
    });

    await expect(sweep()).resolves.toBe(2);

    expect(autoCloseExpired).toHaveBeenCalledWith({
      openedBefore: new Date(now.getTime() - 16 * 60 * 60_000),
    });
  });

  it('reports nothing closed on a quiet pass', async () => {
    const sweep = createCashierSessionSweeper({
      repository: { autoCloseExpired: async () => [] } as never,
    });

    await expect(sweep()).resolves.toBe(0);
  });
});
