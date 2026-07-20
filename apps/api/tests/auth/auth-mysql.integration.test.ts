import { createDatabase } from '@capella/database';
import { adminCredentials, auditEvents, authAttempts, authSessions } from '@capella/database/schema';
import { asc, eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import * as auth from '../../src/modules/auth/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');

beforeEach(async () => {
  await database.delete(auditEvents);
  await database.delete(authAttempts);
  await database.delete(authSessions);
  await database.delete(adminCredentials);
});

describe('MySQL-backed authentication', () => {
  it('keeps an admin session valid across independent app instances', async () => {
    const createAuthModule = Reflect.get(auth, 'createAuthModule');
    expect(createAuthModule).toBeTypeOf('function');
    const dependencies = {
      database,
    };
    const firstModule = createAuthModule(dependencies);
    await firstModule.initializeAdmin({ email: 'admin@capella.test', password: 'integration-password' });
    const firstApp = createApp({ authService: firstModule.service, secureCookies: false });

    const login = await request(firstApp)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@capella.test', password: 'integration-password' });
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];

    const secondModule = createAuthModule(dependencies);
    const secondApp = createApp({ authService: secondModule.service, secureCookies: false });
    const session = await request(secondApp).get('/api/v1/auth/session').set('Cookie', cookie ?? '');
    const logout = await request(secondApp).post('/api/v1/auth/logout').set('Cookie', cookie ?? '');

    expect(login.status).toBe(200);
    expect(session.status).toBe(200);
    expect(session.body.data.actor).toEqual({ type: 'admin' });
    expect(logout.status).toBe(204);
    const events = await database.select().from(auditEvents)
      .where(eq(auditEvents.module, 'auth')).orderBy(asc(auditEvents.id));
    expect(events.map(({ action }) => action)).toEqual([
      'credential_sync', 'login_succeeded', 'session_create', 'logout',
    ]);
    expect(events.slice(1).every((event) => event.requestId !== null)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(cookie ?? 'capella_session=missing');
    expect(JSON.stringify(events)).not.toContain('integration-password');
  });

  it('replaces the stored hash when the env password changes on restart', async () => {
    const createAuthModule = Reflect.get(auth, 'createAuthModule');
    const firstModule = createAuthModule({ database });
    await firstModule.initializeAdmin({ email: 'admin@capella.test', password: 'old-password' });
    const firstApp = createApp({ authService: firstModule.service, secureCookies: false });

    const secondModule = createAuthModule({ database });
    await secondModule.initializeAdmin({ email: 'admin@capella.test', password: 'new-password' });
    const secondApp = createApp({ authService: secondModule.service, secureCookies: false });

    const oldLogin = await request(firstApp).post('/api/v1/auth/admin/login')
      .send({ email: 'admin@capella.test', password: 'old-password' });
    const newLogin = await request(secondApp).post('/api/v1/auth/admin/login')
      .send({ email: 'admin@capella.test', password: 'new-password' });

    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
    const actions = (await database.select({ action: auditEvents.action }).from(auditEvents)
      .where(eq(auditEvents.module, 'auth'))).map(({ action }) => action);
    expect(actions).toEqual(expect.arrayContaining(['login_failed', 'login_succeeded']));
  });
});
