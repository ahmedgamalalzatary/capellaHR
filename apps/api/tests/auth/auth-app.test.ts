import { Writable } from 'node:stream';

import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';

describe('authentication application composition', () => {
  const captureLogs = () => {
    const records: Array<Record<string, unknown>> = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        records.push(JSON.parse(String(chunk)) as Record<string, unknown>);
        callback();
      },
    });
    return { logger: pino({ level: 'info' }, destination), records };
  };

  it('keeps proxy trust disabled unless a trusted hop count is configured', () => {
    expect(createApp().get('trust proxy')).toBe(false);
    expect(createApp({ trustProxyHops: 1 }).get('trust proxy')).toBe(1);
  });

  it('mounts the admin login endpoint under API v1', async () => {
    const service = {
      async loginAdmin() { return { token: 'token', actor: { type: 'admin' as const } }; },
      async loginCashier() { throw new Error('not used'); },
      async beginEmployeeDeviceAuthentication() { throw new Error('not used'); },
      async loginEmployee() { throw new Error('not used'); },
      async logout() { return true; },
      async authenticate() { return null; },
      async revokeEmployeeSessions() {},
    };

    const response = await request(createApp({ authService: service, secureCookies: false }))
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@capella.test', password: 'correct' });

    expect(response.status).toBe(200);
    expect(response.body.data.actor).toEqual({ type: 'admin' });
  });

  it('does not expose Cashier authentication when the ERP account capability is absent', async () => {
    const service = {
      async loginAdmin() { throw new Error('not used'); },
      async loginCashier() { throw new Error('cashier login must not be reachable'); },
      async beginEmployeeDeviceAuthentication() { throw new Error('not used'); },
      async loginEmployee() { throw new Error('not used'); },
      async logout() { return true; },
      async authenticate() { return null; },
      async revokeEmployeeSessions() {},
    };

    const response = await request(createApp({ authService: service, secureCookies: false }))
      .post('/api/v1/auth/cashier/login')
      .send({ username: 'cashier.one', password: 'correct' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('does not expose employee self-service authentication when that capability is disabled', async () => {
    const loginEmployee = vi.fn(async () => { throw new Error('employee login must not be reachable'); });
    const service = {
      async loginAdmin() { throw new Error('not used'); },
      async loginCashier() { throw new Error('not used'); },
      async beginEmployeeDeviceAuthentication() { throw new Error('not used'); },
      loginEmployee,
      async logout() { return true; },
      async authenticate() { return null; },
      async revokeEmployeeSessions() {},
    };

    const response = await request(createApp({
      authService: service,
      employeeAuthenticationEnabled: false,
      secureCookies: false,
    })).post('/api/v1/auth/employee/login').send({
      employeeCode: 12,
      pin: '0123',
      personalPhone: '01012345678',
      installationMarker: 'marker-marker-123',
    });

    expect(response.status).toBe(404);
    expect(loginEmployee).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'Cashier',
      session: {
        id: 'cashier-session', tokenHash: 'hash', actorType: 'account' as const,
        accountRole: 'cashier' as const, accountId: 7, employeeId: 11,
        expiresAt: new Date('2030-01-01T00:00:00.000Z'), revokedAt: null,
      },
      dependencies: {},
    },
    {
      label: 'employee',
      session: {
        id: 'employee-session', tokenHash: 'hash', actorType: 'employee' as const,
        accountRole: null, accountId: null, employeeId: 11,
        expiresAt: new Date('2030-01-01T00:00:00.000Z'), revokedAt: null,
      },
      dependencies: { employeeAuthenticationEnabled: false },
    },
  ])('revokes an existing $label session when its edition capability is disabled', async ({ session, dependencies }) => {
    const logout = vi.fn(async () => true);
    const service = {
      async loginAdmin() { throw new Error('not used'); },
      async loginCashier() { throw new Error('not used'); },
      async beginEmployeeDeviceAuthentication() { throw new Error('not used'); },
      async loginEmployee() { throw new Error('not used'); },
      logout,
      async authenticate() { return session; },
      async revokeEmployeeSessions() {},
    };

    const response = await request(createApp({
      authService: service,
      secureCookies: false,
      ...dependencies,
    })).get('/api/v1/auth/session').set('Cookie', 'capella_session=disabled-token');

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('يجب تسجيل الدخول');
    expect(logout).toHaveBeenCalledWith('disabled-token');
  });

  it('allows credentialed cross-origin requests only from the explicit development list', async () => {
    const developmentApp = createApp({
      ...({ corsOrigins: ['http://localhost:3000', 'http://localhost:3001'] } as Record<string, unknown>),
    });
    const preflight = (origin: string) => request(developmentApp)
      .options('/api/v1/auth/admin/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');

    const web = await preflight('http://localhost:3000');
    const pos = await preflight('http://localhost:3001');
    const rejected = await preflight('https://attacker.example');

    expect(web.status).toBe(204);
    expect(web.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(web.headers['access-control-allow-credentials']).toBe('true');
    expect(pos.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepts production mutations only from the matching configured public origin', async () => {
    const loginAdmin = vi.fn(async () => ({ token: 'token', actor: { type: 'admin' as const } }));
    const service = {
      loginAdmin,
      async loginCashier() { throw new Error('not used'); },
      async beginEmployeeDeviceAuthentication() { throw new Error('not used'); },
      async loginEmployee() { throw new Error('not used'); },
      async logout() { return true; },
      async authenticate() { return null; },
      async revokeEmployeeSessions() {},
    };
    const productionApp = createApp({
      authService: service,
      secureCookies: true,
      trustProxyHops: 1,
      publicOrigins: ['https://hr.example.com', 'https://pos.example.com'],
      ...({ enforceSameOrigin: true } as Record<string, unknown>),
    });
    const sendLogin = (origin?: string) => {
      const pending = request(productionApp)
        .post('/api/v1/auth/admin/login')
        .set('Host', 'hr.example.com')
        .set('X-Forwarded-Proto', 'https');
      if (origin) pending.set('Origin', origin);
      return pending.send({ email: 'admin@capella.test', password: 'correct' });
    };

    const missing = await sendLogin();
    const crossSite = await sendLogin('https://attacker.example');
    const sameOrigin = await sendLogin('https://hr.example.com');
    const spoofedHost = await request(productionApp)
      .post('/api/v1/auth/admin/login')
      .set('Host', 'attacker.example')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://attacker.example')
      .send({ email: 'admin@capella.test', password: 'correct' });
    const posOrigin = await request(productionApp)
      .post('/api/v1/auth/admin/login')
      .set('Host', 'pos.example.com')
      .set('Origin', 'https://pos.example.com')
      .send({ email: 'admin@capella.test', password: 'correct' });

    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('INVALID_ORIGIN');
    expect(crossSite.status).toBe(403);
    expect(crossSite.body.error.code).toBe('INVALID_ORIGIN');
    expect(spoofedHost.status).toBe(403);
    expect(sameOrigin.status).toBe(200);
    expect(posOrigin.status).toBe(200);
    expect(loginAdmin).toHaveBeenCalledTimes(2);
  });

  it('permits mutation origins from the explicit development list and rejects every other origin', async () => {
    const loginAdmin = vi.fn(async () => ({ token: 'token', actor: { type: 'admin' as const } }));
    const service = {
      loginAdmin,
      async loginCashier() { throw new Error('not used'); },
      async beginEmployeeDeviceAuthentication() { throw new Error('not used'); },
      async loginEmployee() { throw new Error('not used'); },
      async logout() { return true; },
      async authenticate() { return null; },
      async revokeEmployeeSessions() {},
    };
    const developmentApp = createApp({
      authService: service,
      secureCookies: false,
      corsOrigins: ['http://localhost:3000', 'http://localhost:3001'],
      enforceSameOrigin: true,
      allowHostOriginFallback: true,
    });
    const sendLogin = (origin: string) => request(developmentApp)
      .post('/api/v1/auth/admin/login')
      .set('Host', 'localhost:4000')
      .set('Origin', origin)
      .send({ email: 'admin@capella.test', password: 'correct' });

    const allowed = await sendLogin('http://localhost:3001');
    const rejected = await sendLogin('http://localhost:3002');

    expect(allowed.status).toBe(200);
    expect(rejected.status).toBe(403);
    expect(rejected.body.error.code).toBe('INVALID_ORIGIN');
    expect(loginAdmin).toHaveBeenCalledTimes(1);
  });

  it('assigns one correlation ID to headers and structured errors', async () => {
    const response = await request(createApp()).get('/api/v1/missing').set('x-request-id', 'client-request-1');
    expect(response.headers['x-request-id']).toBe('client-request-1');
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND', requestId: 'client-request-1' });
  });

  it('exposes backend-owned display settings without authentication', async () => {
    const response = await request(createApp({
      publicConfig: { timeZone: 'Africa/Cairo', locale: 'ar-EG-u-nu-latn' },
    })).get('/api/v1/config');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: { timeZone: 'Africa/Cairo', locale: 'ar-EG-u-nu-latn' },
    });
  });

  it('marks API responses no-store so no cache may retain a per-actor payload', async () => {
    const response = await request(createApp({
      publicConfig: { timeZone: 'Africa/Cairo', locale: 'ar-EG-u-nu-latn' },
    })).get('/api/v1/config');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('never answers a repeated session check with 304', async () => {
    const service = {
      async loginAdmin() { throw new Error('not used'); },
      async loginCashier() { throw new Error('not used'); },
      async loginEmployee() { throw new Error('not used'); },
      async logout() { return true; },
      async authenticate(token: string) {
        return token === 'admin-token'
          ? {
              id: 'session', tokenHash: 'hash', actorType: 'admin' as const,
              employeeId: null, accountId: null,
              expiresAt: new Date('2030-01-01T00:00:00.000Z'), revokedAt: null,
            }
          : null;
      },
      async revokeEmployeeSessions() {},
    };
    const app = createApp({ authService: service, secureCookies: false });
    const first = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', 'capella_session=admin-token');

    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers.etag).toBeUndefined();

    const replayed = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', 'capella_session=admin-token')
      .set('If-None-Match', first.headers.etag ?? '"stale-validator"');

    expect(replayed.status).toBe(200);
    expect(replayed.body).toEqual({ data: { actor: { type: 'admin' } } });
  });

  it('returns a structured Arabic 400 for malformed JSON', async () => {
    const response = await request(createApp()).post('/api/v1/missing').set('content-type', 'application/json').send('{');
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('returns a structured 413 when the JSON body exceeds the configured limit', async () => {
    const response = await request(createApp())
      .post('/api/v1/missing')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ value: 'x'.repeat(110 * 1024) }));

    expect(response.status).toBe(413);
    expect(response.body.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      requestId: response.headers['x-request-id'],
    });
  });

  it('logs completed API requests without verbose request and response objects', async () => {
    const { logger, records } = captureLogs();

    const response = await request(createApp({ logger }))
      .get('/api/v1/health/live?probe=compact')
      .set('x-request-id', 'request-log-1');

    expect(response.status).toBe(200);
    const completed = records.find((record) => record.msg === 'API request completed');
    expect(completed).toEqual(expect.objectContaining({
      level: 30,
      msg: 'API request completed',
      method: 'GET',
      url: '/api/v1/health/live?probe=compact',
      requestId: 'request-log-1',
      statusCode: 200,
      responseTime: expect.any(Number),
    }));
    expect(completed).not.toHaveProperty('req');
    expect(completed).not.toHaveProperty('res');
  });

  it('logs unexpected API exceptions with the stack and correlation ID', async () => {
    const { logger, records } = captureLogs();
    const service = {
      async loginAdmin() { throw new Error('database insert failed'); },
      async loginCashier() { throw new Error('not used'); },
      async loginEmployee() { throw new Error('not used'); },
      async logout() { return true; },
      async authenticate() { return null; },
      async revokeEmployeeSessions() {},
    };

    const response = await request(createApp({
      authService: service,
      secureCookies: false,
      logger,
    })).post('/api/v1/auth/admin/login')
      .set('x-request-id', 'request-error-1')
      .send({ email: 'admin@capella.test', password: 'correct' });

    expect(response.status).toBe(500);
    expect(records).toContainEqual(expect.objectContaining({
      level: 50,
      msg: 'Unhandled API request error',
      requestId: 'request-error-1',
      err: expect.objectContaining({
        message: 'database insert failed',
        stack: expect.stringContaining('database insert failed'),
      }),
    }));
    const failed = records.find((record) => record.msg === 'API request failed');
    expect(failed).toEqual(expect.objectContaining({
      level: 50,
      msg: 'API request failed',
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      requestId: 'request-error-1',
      statusCode: 500,
      responseTime: expect.any(Number),
      err: expect.objectContaining({
        message: 'database insert failed',
        stack: expect.stringContaining('database insert failed'),
      }),
    }));
    expect(failed).not.toHaveProperty('req');
    expect(failed).not.toHaveProperty('res');
  });
});
