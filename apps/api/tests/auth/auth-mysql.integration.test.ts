import { hash } from 'argon2';
import { createDatabase } from '@capella/database';
import { authAttempts, authSessions } from '@capella/database/schema';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import * as auth from '../../src/modules/auth/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');

beforeEach(async () => {
  await database.delete(authAttempts);
  await database.delete(authSessions);
});

describe('MySQL-backed authentication', () => {
  it('keeps an admin session valid across independent app instances', async () => {
    const createAuthModule = Reflect.get(auth, 'createAuthModule');
    expect(createAuthModule).toBeTypeOf('function');
    const passwordHash = await hash('integration-password');
    const dependencies = {
      database,
      admin: { email: 'admin@capella.test', passwordHash },
    };
    const firstModule = createAuthModule(dependencies);
    const firstApp = createApp({ authService: firstModule.service, secureCookies: false });

    const login = await request(firstApp)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@capella.test', password: 'integration-password' });
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];

    const secondModule = createAuthModule(dependencies);
    const secondApp = createApp({ authService: secondModule.service, secureCookies: false });
    const session = await request(secondApp).get('/api/v1/auth/session').set('Cookie', cookie ?? '');

    expect(login.status).toBe(200);
    expect(session.status).toBe(200);
    expect(session.body.data.actor).toEqual({ type: 'admin' });
  });
});
