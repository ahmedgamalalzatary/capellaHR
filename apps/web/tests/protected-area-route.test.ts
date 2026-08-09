import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProtectedAreaAccessHandler } from '../src/app/protected-area-access/handler';

const originalPassword = process.env['PROTECTED_TAB_PASSWORD'];
const originalApiProxyTarget = process.env['API_PROXY_TARGET'];
const handler = () => createProtectedAreaAccessHandler({
  validateSession: async (token) => token === 'valid-session',
});
const request = (password: string, session = 'valid-session') => new Request(
  'http://localhost/protected-area-access',
  {
    method: 'POST',
    headers: { cookie: `capella_session=${session}` },
    body: JSON.stringify({ password }),
  },
);

afterEach(() => {
  if (originalPassword === undefined) {
    delete process.env['PROTECTED_TAB_PASSWORD'];
  } else {
    process.env['PROTECTED_TAB_PASSWORD'] = originalPassword;
  }
  if (originalApiProxyTarget === undefined) {
    delete process.env['API_PROXY_TARGET'];
  } else {
    process.env['API_PROXY_TARGET'] = originalApiProxyTarget;
  }
  vi.unstubAllGlobals();
});

describe('POST /protected-area-access', () => {
  it('accepts the configured password', async () => {
    process.env['PROTECTED_TAB_PASSWORD'] = 'Cap2255';

    const response = await handler()(request('Cap2255'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unlocked: true });
  });

  it('validates the session through the private API proxy target', async () => {
    process.env['PROTECTED_TAB_PASSWORD'] = 'Cap2255';
    process.env['API_PROXY_TARGET'] = 'http://api:4000';
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      data: { actor: { type: 'admin' } },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await createProtectedAreaAccessHandler()(request('Cap2255'));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api:4000/api/v1/auth/session',
      expect.objectContaining({
        headers: { cookie: 'capella_session=valid-session' },
      }),
    );
  });

  it('rejects cross-site protected-area requests before validating the password', async () => {
    process.env['PROTECTED_TAB_PASSWORD'] = 'Cap2255';
    const validateSession = vi.fn(async () => true);
    const protectedHandler = (createProtectedAreaAccessHandler as (
      options: Record<string, unknown>,
    ) => ReturnType<typeof createProtectedAreaAccessHandler>)({
      enforceSameOrigin: true,
      validateSession,
    });
    const crossSite = new Request('https://hr.example.com/protected-area-access', {
      method: 'POST',
      headers: {
        cookie: 'capella_session=valid-session',
        origin: 'https://attacker.example',
      },
      body: JSON.stringify({ password: 'Cap2255' }),
    });

    const response = await protectedHandler(crossSite);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'INVALID_ORIGIN' });
    expect(validateSession).not.toHaveBeenCalled();
  });

  it('rejects a wrong password', async () => {
    process.env['PROTECTED_TAB_PASSWORD'] = 'Cap2255';

    const response = await handler()(request('wrong'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'INVALID_PASSWORD' });
  });

  it('fails closed when no password is configured', async () => {
    delete process.env['PROTECTED_TAB_PASSWORD'];

    const response = await handler()(request('anything'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'NOT_CONFIGURED' });
  });

  it('rate limits repeated attempts per client and permits retry after the window', async () => {
    process.env['PROTECTED_TAB_PASSWORD'] = 'Cap2255';
    let now = 1_000;
    const handler = createProtectedAreaAccessHandler({
      now: () => now,
      maximumAttempts: 2,
      windowMs: 60_000,
      validateSession: async () => true,
    });
    const makeRequest = () => new Request('http://localhost/protected-area-access', {
      method: 'POST',
      headers: {
        cookie: 'capella_session=valid-session',
        'x-real-ip': '203.0.113.7',
      },
      body: JSON.stringify({ password: 'wrong' }),
    });

    expect((await handler(makeRequest())).status).toBe(401);
    expect((await handler(makeRequest())).status).toBe(401);
    const limited = await handler(makeRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(await limited.json()).toEqual({ error: 'TOO_MANY_ATTEMPTS' });

    now += 60_000;
    expect((await handler(makeRequest())).status).toBe(401);
  });

  it('does not trust caller-controlled proxy headers as the limiter identity', async () => {
    process.env['PROTECTED_TAB_PASSWORD'] = 'Cap2255';
    const handler = createProtectedAreaAccessHandler({
      maximumAttempts: 1,
      validateSession: async () => true,
    });
    const request = (spoofedIp: string) => new Request('http://localhost/protected-area-access', {
      method: 'POST',
      headers: {
        cookie: 'capella_session=valid-session',
        'x-real-ip': spoofedIp,
        'x-forwarded-for': spoofedIp,
      },
      body: JSON.stringify({ password: 'wrong' }),
    });

    expect((await handler(request('203.0.113.1'))).status).toBe(401);
    expect((await handler(request('203.0.113.2'))).status).toBe(429);
  });

  it('bounds stored session limiter keys by evicting the oldest window', async () => {
    process.env['PROTECTED_TAB_PASSWORD'] = 'Cap2255';
    const handler = createProtectedAreaAccessHandler({
      maximumAttempts: 1,
      maximumKeys: 2,
      validateSession: async () => true,
    });
    const request = (session: string) => new Request('http://localhost/protected-area-access', {
      method: 'POST',
      headers: { cookie: `capella_session=${session}` },
      body: JSON.stringify({ password: 'wrong' }),
    });

    expect((await handler(request('one'))).status).toBe(401);
    expect((await handler(request('two'))).status).toBe(401);
    expect((await handler(request('three'))).status).toBe(401);
    expect((await handler(request('one'))).status).toBe(401);
  });

  it('rejects missing and invalid API sessions before password validation', async () => {
    process.env['PROTECTED_TAB_PASSWORD'] = 'Cap2255';
    const access = handler();
    const missing = new Request('http://localhost/protected-area-access', {
      method: 'POST',
      body: JSON.stringify({ password: 'Cap2255' }),
    });

    expect((await access(missing)).status).toBe(401);
    const invalid = await access(request('Cap2255', 'forged-session'));
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toEqual({ error: 'UNAUTHENTICATED' });
  });
});
