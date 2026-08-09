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

  it('preserves pagination metadata and downloads private PDF blobs', async () => {
    const json = vi.fn().mockResolvedValue({
      data: { reportType: 'erp-sales' },
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json })
      .mockResolvedValueOnce({ ok: true, status: 200, blob: () => Promise.resolve(blob) }));

    await expect(api.getWithMeta('/reports/erp-sales')).resolves.toMatchObject({
      data: { reportType: 'erp-sales' }, meta: { total: 1 },
    });
    await expect(api.getBlob('/reports/exports/1/download')).resolves.toBe(blob);
  });
});
