import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import * as auth from '../../src/modules/auth/index.js';

const makeApp = () => {
  const createAuthRouter = Reflect.get(auth, 'createAuthRouter');
  expect(createAuthRouter).toBeTypeOf('function');

  const service = {
    async loginAdmin(email: string, password: string) {
      if (email !== 'admin@capella.test' || password !== 'correct') {
        throw new auth.AuthError('INVALID_CREDENTIALS', 'بيانات تسجيل الدخول غير صحيحة');
      }
      return { token: 'admin-token', actor: { type: 'admin' as const } };
    },
    async loginEmployee() {
      return { token: 'employee-token', actor: { type: 'employee' as const, employeeId: 7 } };
    },
    async loginCashier(username: string, password: string) {
      if (username !== 'cashier.one' || password !== 'correct') {
        throw new auth.AuthError('INVALID_CREDENTIALS', 'بيانات تسجيل الدخول غير صحيحة');
      }
      return {
        token: 'cashier-token',
        actor: { type: 'cashier' as const, accountId: 21, employeeId: 7 },
      };
    },
    async beginEmployeeDeviceAuthentication() { return { challengeId: 'challenge', options: {} }; },
    async logout(token: string) { return token === 'admin-token'; },
    async authenticate(token: string) {
      return token === 'admin-token'
        ? {
            id: 'session',
            tokenHash: 'hash',
            actorType: 'admin' as const,
            employeeId: null,
            accountId: null,
            revokedAt: null,
          }
        : null;
    },
    async revokeEmployeeSessions() {},
  };
  const app = express();
  app.use(express.json());
  const cashierAccounts = {
    async promote(input: { employeeId: number; username: string }) {
      return {
        id: 21,
        username: input.username.toLowerCase(),
        role: 'cashier' as const,
        employeeId: input.employeeId,
        branchId: 3,
        active: true,
      };
    },
  };
  app.use('/api/v1/auth', createAuthRouter(service, {
    secureCookies: true,
    cashierAccounts,
  }));
  return app;
};

describe('authentication HTTP API', () => {
  it('sets an opaque protected cookie after admin login', async () => {
    const response = await request(makeApp())
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@capella.test', password: 'correct' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { actor: { type: 'admin' } } });
    expect(response.headers['set-cookie']?.[0]).toContain('capella_session=admin-token');
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain('Secure');
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Strict');
    expect(response.headers['set-cookie']?.[0]).toContain('Path=/;');
    expect(response.body).not.toHaveProperty('data.token');
  });

  it('returns the standard Arabic validation error contract', async () => {
    const response = await request(makeApp()).post('/api/v1/auth/admin/login').send({ email: 'bad', password: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toMatch(/[\u0600-\u06ff]/);
    expect(response.body.error.fieldErrors).toBeDefined();
    expect(response.body.error.requestId).toBeTypeOf('string');
  });

  it('returns a generic unauthorized response for invalid credentials', async () => {
    const response = await request(makeApp())
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@capella.test', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('creates an employee self-service cookie without returning the token', async () => {
    const response = await request(makeApp())
      .post('/api/v1/auth/employee/login')
      .send({ employeeCode: 12, pin: '0123', personalPhone: '01012345678', installationMarker: 'marker-marker-123' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { actor: { type: 'employee' } } });
    expect(response.headers['set-cookie']?.[0]).toContain('capella_session=employee-token');
    expect(response.body).not.toHaveProperty('data.token');
  });

  it('creates a cashier account cookie without returning the token', async () => {
    const response = await request(makeApp())
      .post('/api/v1/auth/cashier/login')
      .send({ username: 'CASHIER.ONE', password: 'correct' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: { actor: { type: 'cashier', accountId: 21, employeeId: 7 } },
    });
    expect(response.headers['set-cookie']?.[0]).toContain('capella_session=cashier-token');
    expect(response.body).not.toHaveProperty('data.token');
  });

  it('returns the current actor from the session cookie', async () => {
    const response = await request(makeApp())
      .get('/api/v1/auth/session')
      .set('Cookie', 'capella_session=admin-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { actor: { type: 'admin' } } });
  });

  it('revokes and clears only the supplied session on logout', async () => {
    const response = await request(makeApp())
      .post('/api/v1/auth/logout')
      .set('Cookie', 'capella_session=admin-token');

    expect(response.status).toBe(204);
    expect(response.headers['set-cookie']?.[0]).toContain('capella_session=;');
  });

  it('allows only an Admin session to promote an employee to Cashier', async () => {
    const unauthorized = await request(makeApp())
      .post('/api/v1/auth/cashier-accounts')
      .send({ employeeId: 7, username: 'Cashier.One', password: 'secret' });
    const promoted = await request(makeApp())
      .post('/api/v1/auth/cashier-accounts')
      .set('Cookie', 'capella_session=admin-token')
      .send({ employeeId: 7, username: 'Cashier.One', password: 'secret' });

    expect(unauthorized.status).toBe(401);
    expect(promoted.status).toBe(201);
    expect(promoted.body).toEqual({
      data: {
        id: 21,
        username: 'cashier.one',
        role: 'cashier',
        employeeId: 7,
        branchId: 3,
        active: true,
      },
    });
  });

  it('maps Cashier promotion conflicts to stable HTTP errors', async () => {
    const createAuthRouter = Reflect.get(auth, 'createAuthRouter');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter({
      async loginAdmin() { throw new Error('not used'); },
      async loginCashier() { throw new Error('not used'); },
      async loginEmployee() { throw new Error('not used'); },
      async logout() { return false; },
      async authenticate() {
        return {
          id: 'admin-session',
          tokenHash: 'hash',
          actorType: 'admin' as const,
          employeeId: null,
          accountId: null,
          revokedAt: null,
        };
      },
      async revokeEmployeeSessions() {},
    }, {
      secureCookies: false,
      cashierAccounts: {
        async promote() {
          throw new auth.CashierAccountError('USERNAME_TAKEN', 'Username is already in use');
        },
      },
    }));

    const response = await request(app)
      .post('/api/v1/auth/cashier-accounts')
      .set('Cookie', 'capella_session=admin-token')
      .send({ employeeId: 7, username: 'cashier.one', password: 'secret' });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({ code: 'USERNAME_TAKEN' });
  });
});
