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
  test('surfaces the nested API error code, Arabic message, and zod field errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'البيانات المدخلة غير صحيحة',
            fieldErrors: { email: ['بريد إلكتروني غير صالح'] },
            requestId: 'req-1',
          },
        }),
      ),
    );

    const error = await api.get('/auth/session').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe('VALIDATION_ERROR');
    expect(apiError.message).toBe('البيانات المدخلة غير صحيحة');
    expect(apiError.fieldErrors).toEqual({ email: ['بريد إلكتروني غير صالح'] });
    expect(apiError.requestId).toBe('req-1');
  });

  test('falls back to a generic Arabic message on a non-JSON error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })),
    );

    const error = await api.get('/employees').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(502);
    expect(apiError.code).toBe('UNEXPECTED_ERROR');
    expect(apiError.message).toBe('حدث خطأ غير متوقع. حاول مرة أخرى.');
  });

  test('maps network failure to an Arabic connectivity error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const error = await api.get('/employees').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(0);
    expect(apiError.code).toBe('NETWORK_ERROR');
    expect(apiError.message).toBe('تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.');
  });

  test('unwraps the data envelope on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { data: { actor: { type: 'admin' } } })),
    );

    await expect(api.get('/auth/session')).resolves.toEqual({ actor: { type: 'admin' } });
  });

  test('returns undefined for 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(api.post('/auth/logout')).resolves.toBeUndefined();
  });
});
