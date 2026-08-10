import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import * as auth from '../../src/modules/auth/index.js';

const makeApp = (actorType: 'admin' | 'employee' | 'account' | null) => {
  const createAuthMiddleware = Reflect.get(auth, 'createAuthMiddleware');
  expect(createAuthMiddleware).toBeTypeOf('function');

  const service = {
    async authenticate(token: string) {
      if (!actorType || token !== 'valid-token') return null;
      return {
        id: 'session-id', tokenHash: 'hash', actorType,
        employeeId: actorType === 'employee' || actorType === 'account' ? 7 : null,
        expiresAt: new Date('2030-01-01T00:00:00.000Z'), revokedAt: null,
        accountId: actorType === 'account' ? 21 : null,
        accountRole: actorType === 'account' ? 'cashier' as const : null,
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
  app.get('/erp', middleware.authenticate, middleware.requireErpAccount, (_request: express.Request, response: express.Response) => {
    response.json({ actor: response.locals.actor });
  });
  return app;
};

describe('authorization middleware', () => {
  it.each([
    ['padding around the value', 'capella_session= valid-token '],
    ['padding around the name', ' capella_session =valid-token'],
    ['a preceding unrelated cookie', 'other=1; capella_session=valid-token'],
    ['a preceding cookie whose value contains a separator', 'other=a=b; capella_session=valid-token'],
  ])('accepts a session cookie with %s', async (_name, cookie) => {
    const response = await request(makeApp('admin')).get('/admin').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.actor).toEqual({ type: 'admin' });
  });

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

  it('allows a cashier through the ERP account boundary but not the Admin boundary', async () => {
    const app = makeApp('account');
    const erp = await request(app).get('/erp').set('Cookie', 'capella_session=valid-token');
    const admin = await request(app).get('/admin').set('Cookie', 'capella_session=valid-token');

    expect(erp.status).toBe(200);
    expect(erp.body.actor).toEqual({
      type: 'cashier',
      accountId: 21,
      employeeId: 7,
    });
    expect(admin.status).toBe(403);
  });
});
