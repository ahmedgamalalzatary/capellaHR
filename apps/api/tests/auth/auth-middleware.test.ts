import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import * as auth from '../../src/modules/auth/index.js';

const makeApp = (actorType: 'admin' | 'employee' | null) => {
  const createAuthMiddleware = Reflect.get(auth, 'createAuthMiddleware');
  expect(createAuthMiddleware).toBeTypeOf('function');

  const service = {
    async authenticate(token: string) {
      if (!actorType || token !== 'valid-token') return null;
      return {
        id: 'session-id', tokenHash: 'hash', actorType,
        employeeId: actorType === 'employee' ? 7 : null, revokedAt: null,
      };
    },
  };
  const middleware = createAuthMiddleware(service);
  const app = express();
  app.get('/admin', middleware.authenticate, middleware.requireAdmin, (_request: express.Request, response: express.Response) => {
    response.json({ actor: response.locals.actor });
  });
  app.get('/employee', middleware.authenticate, middleware.requireEmployee, (_request: express.Request, response: express.Response) => {
    response.json({ actor: response.locals.actor });
  });
  return app;
};

describe('authorization middleware', () => {
  it('rejects requests without an active session', async () => {
    const response = await request(makeApp(null)).get('/admin');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('allows the admin through an admin-only boundary', async () => {
    const response = await request(makeApp('admin')).get('/admin').set('Cookie', 'capella_session=valid-token');

    expect(response.status).toBe(200);
    expect(response.body.actor).toEqual({ type: 'admin' });
  });

  it('forbids an employee from an admin-only boundary', async () => {
    const response = await request(makeApp('employee')).get('/admin').set('Cookie', 'capella_session=valid-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('exposes only the authenticated employee identity', async () => {
    const response = await request(makeApp('employee')).get('/employee').set('Cookie', 'capella_session=valid-token');

    expect(response.status).toBe(200);
    expect(response.body.actor).toEqual({ type: 'employee', employeeId: 7 });
  });
});
