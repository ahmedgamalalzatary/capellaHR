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

  test('getPage keeps both items and pagination meta from list envelopes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          data: [{ id: 1, name: 'القاهرة' }],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    await expect(api.getPage('/branches')).resolves.toEqual({
      items: [{ id: 1, name: 'القاهرة' }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
  });

  test('multipart form posts do not force a JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: { id: 5 } }));
    vi.stubGlobal('fetch', fetchMock);

    const form = new FormData();
    form.append('fullName', 'أحمد');
    await expect(api.postForm('/employees', form)).resolves.toEqual({ id: 5 });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(form);
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  test('patchForm sends multipart updates without a JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: 5 } }));
    vi.stubGlobal('fetch', fetchMock);

    const form = new FormData();
    await expect(api.patchForm('/employees/5', form)).resolves.toEqual({ id: 5 });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  test('returns undefined for 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(api.post('/auth/logout')).resolves.toBeUndefined();
  });
});
