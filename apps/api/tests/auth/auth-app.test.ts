import { Writable } from 'node:stream';

import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

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

  it('allows credentialed requests only from the configured frontend origin', async () => {
    const response = await request(createApp({ corsOrigin: 'http://localhost:3000' }))
      .options('/api/v1/auth/admin/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
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
