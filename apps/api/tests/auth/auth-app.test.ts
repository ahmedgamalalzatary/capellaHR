import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';

describe('authentication application composition', () => {
  it('mounts the admin login endpoint under API v1', async () => {
    const service = {
      async loginAdmin() { return { token: 'token', actor: { type: 'admin' as const } }; },
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
});
