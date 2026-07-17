import { afterEach, describe, expect, test, vi } from 'vitest';

import { api, ApiError } from '../src/lib/api/client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client error contract', () => {
  test('surfaces the API error code, Arabic message, and field errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          code: 'DUPLICATE_PHONE',
          message: 'رقم الهاتف مستخدم بالفعل',
          fieldErrors: [{ field: 'phone', message: 'رقم الهاتف مستخدم بالفعل' }],
          requestId: 'req-1',
        }),
      ),
    );

    const error = await api.get('/employees').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe('DUPLICATE_PHONE');
    expect(apiError.message).toBe('رقم الهاتف مستخدم بالفعل');
    expect(apiError.fieldErrors).toEqual([{ field: 'phone', message: 'رقم الهاتف مستخدم بالفعل' }]);
    expect(apiError.requestId).toBe('req-1');
  });

  test('falls back to a generic Arabic message on a non-JSON error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })),
    );

    const error = await api.get('/employees').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('UNEXPECTED_ERROR');
  });

  test('maps network failure to an Arabic connectivity error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const error = await api.get('/employees').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(0);
    expect(apiError.code).toBe('NETWORK_ERROR');
  });

  test('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { id: 1 })));

    await expect(api.get<{ id: number }>('/employees/1')).resolves.toEqual({ id: 1 });
  });
});
