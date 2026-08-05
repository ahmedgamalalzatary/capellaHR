import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../src/lib/api/client';

describe('POS API client hardening', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts a stalled request with a stable timeout error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise(
      (_resolve, reject) => {
        expect(init?.signal).toBeDefined();
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      },
    )));

    const pending = api.get('/erp/sales/44');
    const rejection = expect(pending).rejects.toMatchObject({
      status: 0, code: 'REQUEST_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
  });
});
