import { createDatabase } from '@capella/database';
import {
  accounts,
  auditEvents,
  authAttempts,
  authLoginLimits,
  authSessions,
  branches,
  employees,
} from '@capella/database/schema';
import { asc, eq, lt } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import * as auth from '../../src/modules/auth/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');

beforeEach(async () => {
  await database.delete(auditEvents);
  await database.delete(authAttempts);
  await database.delete(authLoginLimits);
  await database.delete(authSessions);
  await database.delete(accounts);
  await database.delete(employees).where(eq(employees.employeeCode, 900001));
  await database.delete(branches).where(eq(branches.nameNormalized, 'cashier-auth-integration'));
});

describe('MySQL-backed authentication', () => {
  it('expires Cashier login limits and resets them after a successful login', async () => {
    let now = new Date('2026-07-29T12:00:00.000Z');
    const repositories = auth.createDrizzleAuthRepositories(database, () => now);
    const limitInput = {
      identifier: 'cashier.limit',
      ipAddress: '203.0.113.8',
      now,
      maximumAttempts: 5,
      windowMs: 300_000,
    };
    const reservations = await Promise.all(Array.from({ length: 20 }, () => (
      repositories.attempts.reserveAccountLoginAttempt(limitInput)
    )));
    expect(reservations.filter((result) => result.allowed)).toHaveLength(5);
    expect(reservations.filter((result) => !result.allowed)).toHaveLength(15);

    now = new Date(now.valueOf() + 300_001);
    await expect(repositories.attempts.reserveAccountLoginAttempt({
      identifier: limitInput.identifier,
      ipAddress: limitInput.ipAddress,
      now,
      maximumAttempts: 5,
      windowMs: 300_000,
    })).resolves.toMatchObject({ allowed: true });

    const resettable = await repositories.attempts.reserveAccountLoginAttempt({
      identifier: 'cashier.reset',
      ipAddress: null,
      now,
      maximumAttempts: 5,
      windowMs: 300_000,
    });
    expect(resettable.allowed).toBe(true);
    if (!resettable.allowed) throw new Error('Expected an allowed reservation');
    await repositories.attempts.resetAccountLoginLimits(resettable.reservation);
    await expect(repositories.attempts.reserveAccountLoginAttempt({
      identifier: 'cashier.reset',
      ipAddress: null,
      now,
      maximumAttempts: 5,
      windowMs: 300_000,
    })).resolves.toMatchObject({ allowed: true });
  });

  it('does not erase a concurrent failed reservation when an earlier login succeeds', async () => {
    const now = new Date('2026-07-29T12:00:00.000Z');
    const repositories = auth.createDrizzleAuthRepositories(database, () => now);
    const input = {
      identifier: 'cashier.concurrent',
      ipAddress: '203.0.113.9',
      now,
      maximumAttempts: 5,
      windowMs: 300_000,
    };
    const successfulLoginReservation = await repositories.attempts.reserveAccountLoginAttempt(input);
    const concurrentFailureReservation = await repositories.attempts.reserveAccountLoginAttempt({
      ...input,
      identifier: 'cashier.concurrent.other',
    });
    expect(successfulLoginReservation.allowed).toBe(true);
    expect(concurrentFailureReservation.allowed).toBe(true);
    if (!successfulLoginReservation.allowed) throw new Error('Expected an allowed reservation');

    await repositories.attempts.resetAccountLoginLimits(
      successfulLoginReservation.reservation,
    );

    const rows = await database.select().from(authLoginLimits);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.attemptCount).sort()).toEqual([1, 2]);
  });

  it('does not let a successful account reset the shared IP spray limit', async () => {
    const now = new Date('2026-07-29T12:00:00.000Z');
    const repositories = auth.createDrizzleAuthRepositories(database, () => now);
    const ipAddress = '203.0.113.10';
    const successful = await repositories.attempts.reserveAccountLoginAttempt({
      identifier: 'cashier.known',
      ipAddress,
      now,
      maximumAttempts: 5,
      windowMs: 300_000,
    });
    expect(successful.allowed).toBe(true);
    if (!successful.allowed) throw new Error('Expected an allowed reservation');
    await repositories.attempts.resetAccountLoginLimits(successful.reservation);

    const guesses = [];
    for (let index = 0; index < 5; index += 1) {
      guesses.push(await repositories.attempts.reserveAccountLoginAttempt({
        identifier: `cashier.guess.${index}`,
        ipAddress,
        now,
        maximumAttempts: 5,
        windowMs: 300_000,
      }));
    }

    expect(guesses.filter((result) => result.allowed)).toHaveLength(4);
    expect(guesses[4]).toMatchObject({ allowed: false });
  });

  it('removes only a bounded batch of expired login-limit keys', async () => {
    const now = new Date('2026-07-29T12:00:00.000Z');
    const staleAt = new Date(now.valueOf() - 2 * 24 * 60 * 60_000);
    const repositories = auth.createDrizzleAuthRepositories(database, () => now);
    await database.insert(authLoginLimits).values(Array.from({ length: 120 }, (_, index) => ({
      key: `i:${String(index).padStart(64, '0')}`,
      attemptCount: 1,
      version: 1,
      windowStartedAt: staleAt,
      updatedAt: staleAt,
    })));

    await repositories.attempts.reserveAccountLoginAttempt({
      identifier: 'cashier.cleanup',
      ipAddress: null,
      now,
      maximumAttempts: 5,
      windowMs: 300_000,
    });

    const staleRows = await database.select().from(authLoginLimits)
      .where(lt(authLoginLimits.updatedAt, new Date(now.valueOf() - 24 * 60 * 60_000)));
    expect(staleRows).toHaveLength(20);
  });

  it('returns a committed reservation when best-effort retention fails', async () => {
    const now = new Date('2026-07-29T12:00:00.000Z');
    const cleanupError = new Error('retention unavailable');
    const reportCleanupError = vi.fn();
    const repositories = auth.createDrizzleAuthRepositories(database, () => now, {
      cleanupLoginLimits: async () => { throw cleanupError; },
      onLoginLimitCleanupError: reportCleanupError,
    });

    const result = await repositories.attempts.reserveAccountLoginAttempt({
      identifier: 'cashier.cleanup.failure',
      ipAddress: null,
      now,
      maximumAttempts: 5,
      windowMs: 300_000,
    });

    expect(result).toMatchObject({ allowed: true });
    expect(reportCleanupError).toHaveBeenCalledWith(cleanupError);
  });

  it('assigns a branch login and persists a Cashier session across app instances', async () => {
    const now = new Date('2026-07-29T12:00:00.000Z');
    const branchId = Number((await database.insert(branches).values({
      name: 'Cashier integration branch',
      nameNormalized: 'cashier-auth-integration',
      location: 'Cairo',
      latitude: 30,
      longitude: 31,
      gpsAccuracyMeters: 5,
      attendanceRadiusMeters: 100,
      hasEverBeenReferenced: true,
      createdAt: now,
      updatedAt: now,
    }))[0].insertId);

    const firstModule = auth.createAuthModule({ database });
    await firstModule.initializeAdmin({
      email: 'admin@capella.test',
      password: 'integration-password',
    });
    const firstApp = createApp({
      authService: firstModule.service,
      cashierAccountsService: firstModule.cashierAccounts,
      secureCookies: false,
    });
    const adminLogin = await request(firstApp)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@capella.test', password: 'integration-password' });
    const adminCookie = adminLogin.headers['set-cookie']?.[0]?.split(';')[0];
    const assignment = await request(firstApp)
      .post('/api/v1/auth/cashier-accounts')
      .set('Cookie', adminCookie ?? '')
      .send({ branchId, username: 'Cashier.Integration', password: 'cashier-password' });
    const cashierLogin = await request(firstApp)
      .post('/api/v1/auth/cashier/login')
      .send({ username: 'cashier.integration', password: 'cashier-password' });
    const cashierCookie = cashierLogin.headers['set-cookie']?.[0]?.split(';')[0];

    const secondModule = auth.createAuthModule({ database });
    const secondApp = createApp({
      authService: secondModule.service,
      cashierAccountsService: secondModule.cashierAccounts,
      secureCookies: false,
    });
    const session = await request(secondApp)
      .get('/api/v1/auth/session')
      .set('Cookie', cashierCookie ?? '');

    expect(assignment.status).toBe(201);
    expect(assignment.body.data).toMatchObject({
      username: 'cashier.integration',
      role: 'cashier',
      branchId,
      active: true,
    });
    expect(assignment.body.data).not.toHaveProperty('employeeId');
    expect(cashierLogin.status).toBe(200);
    expect(session.status).toBe(200);
    expect(session.body.data.actor).toEqual({
      type: 'cashier',
      accountId: assignment.body.data.id,
    });
    expect(JSON.stringify(assignment.body)).not.toContain('passwordHash');
    expect((await database.select().from(auditEvents)
      .where(eq(auditEvents.actorType, 'account'))).length).toBeGreaterThan(0);
  });

  it('revokes Cashier sessions on disable and password reset', async () => {
    const createAuthModule = Reflect.get(auth, 'createAuthModule');
    const module = createAuthModule({ database });
    await module.initializeAdmin({ email: 'admin@capella.test', password: 'admin-password' });
    const branch = await database.insert(branches).values({
      name: 'Cashier auth integration', nameNormalized: 'cashier-auth-integration',
      location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5,
      attendanceRadiusMeters: 100, hasEverBeenReferenced: true,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await database.insert(employees).values({
      employeeCode: 900001, fullName: 'Cashier', personalPhone: '01009000001',
      whatsappPhone: '01009000001', pinHash: 'hash', credentialVersion: 1,
      age: 25, address: 'Cairo', branchId: Number(branch[0].insertId),
      shiftDurationMinutes: 480, monthlyBaseSalary: '1000.00', employmentStatus: 'active',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const app = createApp({
      authService: module.service,
      cashierAccountsService: module.cashierAccounts,
      secureCookies: false,
    });
    const adminLogin = await request(app).post('/api/v1/auth/admin/login')
      .send({ email: 'admin@capella.test', password: 'admin-password' });
    const adminCookie = adminLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const assigned = await request(app).post('/api/v1/auth/cashier-accounts')
      .set('Cookie', adminCookie)
      .send({ branchId: Number(branch[0].insertId), username: 'cashier.one', password: 'old-password' });
    const accountId = assigned.body.data.id as number;
    const cashierLogin = await request(app).post('/api/v1/auth/cashier/login')
      .send({ username: 'cashier.one', password: 'old-password' });
    const cashierCookie = cashierLogin.headers['set-cookie']?.[0]?.split(';')[0] ?? '';

    await request(app).patch(`/api/v1/auth/cashier-accounts/${accountId}/status`)
      .set('Cookie', adminCookie).send({ active: false }).expect(200);
    await request(app).get('/api/v1/auth/session').set('Cookie', cashierCookie).expect(401);
    expect((await database.select({ active: accounts.active }).from(accounts)
      .where(eq(accounts.id, accountId)).limit(1))[0]?.active).toBe(false);

    await request(app).patch(`/api/v1/auth/cashier-accounts/${accountId}/status`)
      .set('Cookie', adminCookie).send({ active: true }).expect(200);
    const relogin = await request(app).post('/api/v1/auth/cashier/login')
      .send({ username: 'cashier.one', password: 'old-password' });
    const secondCookie = relogin.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    await request(app).patch(`/api/v1/auth/cashier-accounts/${accountId}/password`)
      .set('Cookie', adminCookie).send({ password: 'new-password' }).expect(200);

    await request(app).get('/api/v1/auth/session').set('Cookie', secondCookie).expect(401);
    await request(app).post('/api/v1/auth/cashier/login')
      .send({ username: 'cashier.one', password: 'old-password' }).expect(401);
    await request(app).post('/api/v1/auth/cashier/login')
      .send({ username: 'cashier.one', password: 'new-password' }).expect(200);
  });

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

  it('rejects an expired account session', async () => {
    const module = auth.createAuthModule({ database });
    await module.initializeAdmin({ email: 'admin@capella.test', password: 'integration-password' });
    const app = createApp({ authService: module.service, secureCookies: false });
    const login = await request(app).post('/api/v1/auth/admin/login')
      .send({ email: 'admin@capella.test', password: 'integration-password' });
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    await database.update(authSessions).set({ expiresAt: new Date('2000-01-01T00:00:00.000Z') });

    await request(app).get('/api/v1/auth/session').set('Cookie', cookie).expect(401);
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
