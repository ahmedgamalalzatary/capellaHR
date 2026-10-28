import { describe, expect, it, vi } from 'vitest';

import { isDeadlock, withDeadlockRetry } from '../../src/modules/erp/stock/deadlock-retry.js';

describe('deadlock retry', () => {
  it('recognises a deadlock, including a wrapped one', () => {
    expect(isDeadlock({ errno: 1213 })).toBe(true);
    expect(isDeadlock({ code: 'ER_LOCK_DEADLOCK' })).toBe(true);
    expect(isDeadlock({ cause: { errno: 1213 } })).toBe(true);
    expect(isDeadlock({ errno: 1205 })).toBe(false);
    expect(isDeadlock(new Error('nope'))).toBe(false);
  });

  it('replays the work once when the first attempt deadlocked', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce({ cause: { errno: 1213 } })
      .mockResolvedValueOnce('created');

    await expect(withDeadlockRetry(run)).resolves.toBe('created');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not replay any other failure', async () => {
    const run = vi.fn().mockRejectedValueOnce({ errno: 1205 });

    await expect(withDeadlockRetry(run)).rejects.toMatchObject({ errno: 1205 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('gives up after the second deadlock', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce({ errno: 1213 })
      .mockRejectedValueOnce({ errno: 1213 });

    await expect(withDeadlockRetry(run)).rejects.toMatchObject({ errno: 1213 });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
