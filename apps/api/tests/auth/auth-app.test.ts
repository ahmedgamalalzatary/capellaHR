import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';

describe('authentication application composition', () => {
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
});
