import { createDatabase } from '@capella/database';
import {
  accounts,
  auditEvents,
  authSessions,
  cashierSessions,
  employees,
  branches,
} from '@capella/database/schema';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createAuditModule, createErpAuditCapability, runWithAuditContext } from '../../src/modules/audit/index.js';
import { createAuthModule } from '../../src/modules/auth/index.js';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createEmployeesModule } from '../../src/modules/employees/index.js';
import * as sales from '../../src/modules/erp/sales/index.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const now = new Date('2026-08-01T10:00:00.000Z');
const created = {
  accountIds: [] as number[],
  employeeIds: [] as number[],
  branchIds: [] as number[],
  authSessionIds: [] as string[],
};

afterEach(async () => {
  const sessionIds = created.branchIds.length > 0
    ? (await database.select({ id: cashierSessions.id }).from(cashierSessions)
      .where(inArray(cashierSessions.branchId, created.branchIds))).map(({ id }) => String(id))
    : [];
  if (created.branchIds.length > 0) {
    await database.delete(cashierSessions).where(inArray(cashierSessions.branchId, created.branchIds));
  }
  if (created.authSessionIds.length > 0) {
    await database.delete(authSessions).where(inArray(authSessions.id, created.authSessionIds));
  }
  if (created.accountIds.length > 0) {
    await database.delete(auditEvents).where(and(
      eq(auditEvents.module, 'auth'),
      inArray(auditEvents.entityId, created.accountIds.map(String)),
    ));
  }
  if (sessionIds.length > 0) {
    await database.delete(auditEvents).where(and(
      eq(auditEvents.module, 'erp_cashier_sessions'),
      inArray(auditEvents.entityId, sessionIds),
    ));
  }
  if (created.accountIds.length > 0) {
    await database.delete(accounts).where(inArray(accounts.id, created.accountIds));
  }
  if (created.employeeIds.length > 0) {
    await database.delete(employees).where(inArray(employees.id, created.employeeIds));
  }
  if (created.branchIds.length > 0) {
    await database.delete(branches).where(inArray(branches.id, created.branchIds));
  }
  created.accountIds.length = 0;
  created.employeeIds.length = 0;
  created.branchIds.length = 0;
  created.authSessionIds.length = 0;
});

const fixture = async () => {
  const unique = `${Date.now()}-${Math.random()}`;
  const branchId = Number((await database.insert(branches).values({
    name: `ERP 4 ${unique}`,
    nameNormalized: `erp4-${unique}`,
    location: 'Cairo',
    latitude: 30,
    longitude: 31,
    gpsAccuracyMeters: 5,
    attendanceRadiusMeters: 100,
    hasEverBeenReferenced: true,
    createdAt: now,
    updatedAt: now,
  }))[0].insertId);
  created.branchIds.push(branchId);

  const makeAccount = async (suffix: number) => {
    const employeeId = Number((await database.insert(employees).values({
      employeeCode: 940000 + suffix + Math.floor(Math.random() * 1000),
      fullName: `ERP 4 Cashier ${suffix}`,
      personalPhone: `01009${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
      whatsappPhone: `01109${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
      pinHash: 'unused',
      age: 30,
      address: 'Cairo',
      branchId,
      shiftDurationMinutes: 480,
      monthlyBaseSalary: '5000.00',
      createdAt: now,
      updatedAt: now,
    }))[0].insertId);
    created.employeeIds.push(employeeId);
    const username = `erp4.${suffix}.${unique}`.slice(0, 255);
    const accountId = Number((await database.insert(accounts).values({
      username,
      passwordHash: 'unused',
      role: 'cashier',
      employeeId,
      active: true,
      createdAt: now,
      updatedAt: now,
    }))[0].insertId);
    created.accountIds.push(accountId);
    return { accountId, employeeId, username };
  };

  return {
    branchId,
    first: await makeAccount(1),
    second: await makeAccount(2),
  };
};

const repository = () => {
  const create = Reflect.get(sales, 'createDrizzleCashierSessionRepository');
  return create(database, createErpAuditCapability());
};

const sessionCookie = async (accountId: number) => {
  const token = randomUUID();
  const id = randomUUID();
  created.authSessionIds.push(id);
  await database.insert(authSessions).values({
    id,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    actorType: 'account',
    employeeId: null,
    accountId,
    createdAt: now,
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    revokedAt: null,
  });
  return `capella_session=${token}`;
};

describe('ERP Cashier-session repository', () => {
  it('publishes the Drizzle repository through the sales module boundary', () => {
    expect(Reflect.get(sales, 'createDrizzleCashierSessionRepository')).toBeTypeOf('function');
  });

  it('opens and reads the branch session with account and branch ownership labels', async () => {
    const data = await fixture();
    const result = await repository().open({
      branchId: data.branchId,
      openedByAccountId: data.first.accountId,
      openedAt: now,
    });

    expect(result).toMatchObject({
      kind: 'success',
      session: {
        branchId: data.branchId,
        openedByAccountId: data.first.accountId,
        openedByUsername: data.first.username,
        openedAt: now,
        closedAt: null,
      },
    });
    await expect(repository().findOpenByBranch(data.branchId))
      .resolves.toMatchObject({ openedByAccountId: data.first.accountId });
    const audit = await database.select().from(auditEvents).where(and(
      eq(auditEvents.module, 'erp_cashier_sessions'),
      sql`JSON_UNQUOTE(JSON_EXTRACT(${auditEvents.relatedIds}, '$.branchId')) = ${String(data.branchId)}`,
    ));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'open', actorType: 'system' });
  });

  it('turns concurrent branch opens into one stored session and stable conflicts', async () => {
    const data = await fixture();
    const repo = repository();
    const results = await Promise.all([
      repo.open({ branchId: data.branchId, openedByAccountId: data.first.accountId, openedAt: now }),
      repo.open({ branchId: data.branchId, openedByAccountId: data.second.accountId, openedAt: now }),
    ]);

    expect(results.filter((result: { kind: string }) => result.kind === 'success')).toHaveLength(1);
    expect(results.filter((result: { kind: string }) => result.kind === 'already_open')).toHaveLength(1);
    expect(await database.select().from(cashierSessions)
      .where(eq(cashierSessions.branchId, data.branchId))).toHaveLength(1);
  });

  it('prevents another Cashier from closing the session and permits the owner', async () => {
    const data = await fixture();
    const repo = repository();
    await repo.open({ branchId: data.branchId, openedByAccountId: data.first.accountId, openedAt: now });

    await expect(repo.close({
      branchId: data.branchId,
      closedByAccountId: data.second.accountId,
      closedAt: new Date(now.valueOf() + 60_000),
    })).resolves.toMatchObject({ kind: 'not_owner' });
    await expect(repo.close({
      branchId: data.branchId,
      closedByAccountId: data.first.accountId,
      closedAt: new Date(now.valueOf() + 60_000),
    })).resolves.toMatchObject({
      kind: 'success',
      session: { closedByAccountId: data.first.accountId },
    });
    await expect(repo.findOpenByBranch(data.branchId)).resolves.toBeNull();
  });

  it('recovery-closes atomically and stores the mandatory reason in the Admin audit event', async () => {
    const data = await fixture();
    const repo = repository();
    const opened = await repo.open({
      branchId: data.branchId,
      openedByAccountId: data.first.accountId,
      openedAt: now,
    });
    if (opened.kind !== 'success') throw new Error('Expected the fixture session to open');

    const result = await runWithAuditContext({
      actorType: 'account',
      actorIdentifier: String(data.second.accountId),
      requestId: 'erp4-recovery',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    }, () => repo.recoveryClose({
      sessionId: opened.session.id,
      closedByAccountId: data.second.accountId,
      closedAt: new Date(now.valueOf() + 120_000),
      reason: 'انقطاع جهاز الكاشير',
    }));

    expect(result).toMatchObject({
      kind: 'success',
      session: { closedByAccountId: data.second.accountId },
    });
    const [audit] = await database.select().from(auditEvents).where(eq(
      auditEvents.requestId,
      'erp4-recovery',
    ));
    expect(audit).toMatchObject({
      action: 'recovery_close',
      actorType: 'account',
      actorIdentifier: String(data.second.accountId),
    });
    expect(audit?.afterState).toMatchObject({ recoveryReason: 'انقطاع جهاز الكاشير' });
  });

  it('distinguishes missing and already-closed recovery targets', async () => {
    const data = await fixture();
    const repo = repository();
    await expect(repo.recoveryClose({
      sessionId: 2_147_483_647,
      closedByAccountId: data.second.accountId,
      closedAt: now,
      reason: 'سبب',
    })).resolves.toEqual({ kind: 'not_found' });

    const opened = await repo.open({
      branchId: data.branchId,
      openedByAccountId: data.first.accountId,
      openedAt: now,
    });
    if (opened.kind !== 'success') throw new Error('Expected the fixture session to open');
    await repo.close({
      branchId: data.branchId,
      closedByAccountId: data.first.accountId,
      closedAt: new Date(now.valueOf() + 60_000),
    });
    await expect(repo.recoveryClose({
      sessionId: opened.session.id,
      closedByAccountId: data.second.accountId,
      closedAt: new Date(now.valueOf() + 120_000),
      reason: 'سبب',
    })).resolves.toMatchObject({ kind: 'already_closed' });
  });

  it('runs authenticated normal and Admin recovery flows through the real app and MySQL', async () => {
    const data = await fixture();
    const authModule = createAuthModule({ database });
    const branchModule = createBranchesModule(database);
    const employeeModule = createEmployeesModule(database, 1_000_000);
    const auditModule = createAuditModule(database, { timeZone: 'Africa/Cairo' });
    const makeApp = () => {
      const salesModule = sales.createSalesModule(database, {
        audit: auditModule.erp,
        branches: branchModule.erp,
        employees: employeeModule.erp,
        assignment: {
          listAssignable: async () => [],
          assertAssignable: async () => { throw new Error('not used'); },
        },
      });
      return createApp({
        authService: authModule.service,
        cashierSessionService: salesModule.cashierSessions,
        secureCookies: false,
      });
    };
    const firstCookie = await sessionCookie(data.first.accountId);
    const secondCookie = await sessionCookie(data.second.accountId);
    const [admin] = await database.select({ id: accounts.id }).from(accounts)
      .where(and(eq(accounts.role, 'admin'), eq(accounts.active, true)))
      .limit(1);
    if (!admin) throw new Error('The integration database must contain its singleton active Admin');
    const adminCookie = await sessionCookie(admin.id);

    const opened = await request(makeApp())
      .post('/api/v1/erp/cashier-sessions/open')
      .set('Cookie', firstCookie);
    const restored = await request(makeApp())
      .get('/api/v1/erp/cashier-sessions/current')
      .set('Cookie', firstCookie);
    const conflict = await request(makeApp())
      .post('/api/v1/erp/cashier-sessions/open')
      .set('Cookie', secondCookie);
    const wrongOwner = await request(makeApp())
      .post('/api/v1/erp/cashier-sessions/close')
      .set('Cookie', secondCookie);
    const closed = await request(makeApp())
      .post('/api/v1/erp/cashier-sessions/close')
      .set('Cookie', firstCookie);
    const afterClose = await request(makeApp())
      .get('/api/v1/erp/cashier-sessions/current')
      .set('Cookie', firstCookie);
    const reopened = await request(makeApp())
      .post('/api/v1/erp/cashier-sessions/open')
      .set('Cookie', firstCookie);
    const cashierRecovery = await request(makeApp())
      .post(`/api/v1/erp/cashier-sessions/${reopened.body.data.id}/recovery-close`)
      .set('Cookie', secondCookie)
      .send({ reason: 'محاولة غير مسموحة' });
    const recovery = await request(makeApp())
      .post(`/api/v1/erp/cashier-sessions/${reopened.body.data.id}/recovery-close`)
      .set('Cookie', adminCookie)
      .set('X-Request-Id', 'erp4-e2e-admin-recovery')
      .send({ reason: '  تعطل جهاز الكاشير  ' });
    const afterRecovery = await request(makeApp())
      .get(`/api/v1/erp/cashier-sessions/current?branchId=${data.branchId}`)
      .set('Cookie', adminCookie);

    expect(opened.status).toBe(201);
    expect(opened.body.data).toMatchObject({
      branchId: data.branchId,
      openedByAccountId: data.first.accountId,
      openedByUsername: data.first.username,
      closedAt: null,
    });
    expect(restored.status).toBe(200);
    expect(restored.body.data.id).toBe(opened.body.data.id);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('ERP_CASHIER_SESSION_ALREADY_OPEN');
    expect(wrongOwner.status).toBe(403);
    expect(wrongOwner.body.error.code).toBe('ERP_CASHIER_SESSION_NOT_OWNER');
    expect(closed.status).toBe(200);
    expect(closed.body.data.closedByAccountId).toBe(data.first.accountId);
    expect(afterClose.status).toBe(200);
    expect(afterClose.body.data).toBeNull();
    expect(reopened.status).toBe(201);
    expect(cashierRecovery.status).toBe(403);
    expect(cashierRecovery.body.error.code).toBe('ERP_CASHIER_SESSION_ADMIN_REQUIRED');
    expect(recovery.status).toBe(200);
    expect(recovery.body.data).toMatchObject({
      id: reopened.body.data.id,
      closedByAccountId: admin.id,
    });
    expect(afterRecovery.status).toBe(200);
    expect(afterRecovery.body.data).toBeNull();
    const [recoveryAudit] = await database.select().from(auditEvents).where(eq(
      auditEvents.requestId,
      'erp4-e2e-admin-recovery',
    ));
    expect(recoveryAudit).toMatchObject({
      module: 'erp_cashier_sessions',
      action: 'recovery_close',
      actorType: 'account',
      actorIdentifier: String(admin.id),
      entityId: String(reopened.body.data.id),
    });
    expect(recoveryAudit?.afterState).toMatchObject({ recoveryReason: 'تعطل جهاز الكاشير' });
    expect(JSON.stringify(opened.body)).not.toContain('passwordHash');
  });
});
