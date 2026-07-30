import { createHash, randomUUID } from 'node:crypto';

import { type createDatabase } from '@capella/database';
import {
  accounts,
  adminCredentials,
  authAttempts,
  authLoginLimits,
  authSessions,
  employees,
} from '@capella/database/schema';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import type {
  AccountCredentialRepository,
  AdminCredentialRepository,
  AttemptRepository,
  SessionRepository,
} from './auth-service.js';

type Database = ReturnType<typeof createDatabase>;

const loginLimitKeys = (identifier: string, ipAddress: string | null) => [
  `i:${createHash('sha256').update(identifier).digest('hex')}`,
  ...(ipAddress === null
    ? []
    : [`p:${createHash('sha256').update(ipAddress).digest('hex')}`]),
].sort();

export const createDrizzleAuthRepositories = (
  database: Database,
  now: () => Date = () => new Date(),
  options: {
    cleanupLoginLimits?: (expiredBefore: Date) => Promise<void>;
    onLoginLimitCleanupError?: (error: unknown) => void;
  } = {},
): {
  accountCredentials: AccountCredentialRepository;
  adminCredentials: AdminCredentialRepository;
  sessions: SessionRepository;
  attempts: AttemptRepository;
} => ({
  accountCredentials: {
    async findCashierByUsername(username) {
      const row = (await database.select({
        id: accounts.id,
        username: accounts.username,
        passwordHash: accounts.passwordHash,
        role: accounts.role,
        employeeId: accounts.employeeId,
        active: accounts.active,
      }).from(accounts).where(and(
        eq(accounts.username, username),
        eq(accounts.role, 'cashier'),
      )).limit(1))[0];
      return row?.role === 'cashier' && row.employeeId !== null
        ? { ...row, role: 'cashier' as const, employeeId: row.employeeId }
        : null;
    },
  },
  adminCredentials: {
    async findByEmail(email) {
      const rows = await database.select({
        email: adminCredentials.email,
        passwordHash: adminCredentials.passwordHash,
      }).from(adminCredentials).where(eq(adminCredentials.email, email.toLowerCase())).limit(1);
      return rows[0] ?? null;
    },
  },
  sessions: {
    async create(session) {
      await database.transaction(async (tx) => {
        const createdAt = now();
        await tx.insert(authSessions).values({ ...session, createdAt });
        await writeAudit(tx, {
          actor: {
            type: session.actorType,
            identifier: session.actorType === 'admin' ? 'admin' : String(session.employeeId),
          },
          module: 'auth', action: 'session_create', entityType: 'session', entityId: session.id,
          afterState: { actorType: session.actorType, employeeId: session.employeeId },
          ...(session.employeeId === null ? {} : { relatedIds: { employeeId: session.employeeId } }),
          createdAt,
        });
      });
    },
    async createAccountIfCurrent(session) {
      return database.transaction(async (tx) => {
        const account = (await tx.select({
          id: accounts.id,
          role: accounts.role,
          employeeId: accounts.employeeId,
          active: accounts.active,
        }).from(accounts).where(eq(accounts.id, session.accountId!)).for('update').limit(1))[0];
        if (!account || !account.active || account.role !== 'cashier' || account.employeeId === null) {
          return 'account_invalid';
        }
        const employee = (await tx.select({
          id: employees.id,
          employmentStatus: employees.employmentStatus,
          deletedAt: employees.deletedAt,
        }).from(employees).where(eq(employees.id, account.employeeId)).for('update').limit(1))[0];
        if (!employee || employee.deletedAt || employee.employmentStatus !== 'active') {
          return 'account_invalid';
        }
        const createdAt = now();
        await tx.insert(authSessions).values({ ...session, createdAt });
        await writeAudit(tx, {
          actor: { type: 'account', identifier: String(account.id) },
          module: 'auth',
          action: 'session_create',
          entityType: 'session',
          entityId: session.id,
          afterState: {
            actorType: session.actorType,
            accountId: account.id,
            role: account.role,
          },
          relatedIds: {
            accountId: account.id,
            employeeId: account.employeeId,
          },
          createdAt,
        });
        return 'created';
      });
    },
    async createEmployeeIfCurrent(session, credentialVersion, deviceEligible, attendanceEligible) {
      return database.transaction(async (tx) => {
        const employee = (await tx.select({ credentialVersion: employees.credentialVersion, employmentStatus: employees.employmentStatus, deletedAt: employees.deletedAt }).from(employees).where(eq(employees.id, session.employeeId!)).for('update').limit(1))[0];
        if (!employee || employee.deletedAt || employee.employmentStatus === 'inactive' || employee.credentialVersion !== credentialVersion) return 'credentials_changed';
        if (!await deviceEligible(tx)) return 'device_invalid';
        if (!await attendanceEligible(tx)) return 'attendance_required';
        const createdAt = now();
        await tx.insert(authSessions).values({ ...session, createdAt });
        await writeAudit(tx, {
          actor: { type: 'employee', identifier: String(session.employeeId) },
          module: 'auth', action: 'session_create', entityType: 'session', entityId: session.id,
          afterState: { actorType: session.actorType, employeeId: session.employeeId },
          relatedIds: { employeeId: session.employeeId! }, createdAt,
        });
        return 'created';
      });
    },
    async findActiveByTokenHash(tokenHash) {
      const row = (await database.select({
        id: authSessions.id,
        tokenHash: authSessions.tokenHash,
        actorType: authSessions.actorType,
        employeeId: authSessions.employeeId,
        accountId: authSessions.accountId,
        revokedAt: authSessions.revokedAt,
      }).from(authSessions)
        .where(and(
          eq(authSessions.tokenHash, tokenHash),
          isNull(authSessions.revokedAt),
        )).limit(1))[0];
      if (!row) return null;
      if (row.actorType === 'admin') return { ...row, accountRole: null };
      if (row.actorType === 'employee') {
        const employee = (await database.select({ id: employees.id }).from(employees).where(and(
          eq(employees.id, row.employeeId!),
          eq(employees.employmentStatus, 'active'),
          isNull(employees.deletedAt),
        )).limit(1))[0];
        return employee ? { ...row, accountRole: null } : null;
      }
      const account = (await database.select({
        role: accounts.role,
        employeeId: accounts.employeeId,
      }).from(accounts).innerJoin(employees, eq(employees.id, accounts.employeeId)).where(and(
        eq(accounts.id, row.accountId!),
        eq(accounts.active, true),
        eq(accounts.role, 'cashier'),
        eq(employees.employmentStatus, 'active'),
        isNull(employees.deletedAt),
      )).limit(1))[0];
      if (!account || account.role !== 'cashier' || account.employeeId === null) {
        await database.transaction(async (tx) => {
          const revokedAt = now();
          const result = await tx.update(authSessions).set({ revokedAt }).where(and(
            eq(authSessions.id, row.id),
            isNull(authSessions.revokedAt),
          ));
          if (result[0].affectedRows === 1) {
            await writeAudit(tx, {
              actor: { type: 'account', identifier: String(row.accountId) },
              module: 'auth',
              action: 'session_revoke',
              entityType: 'session',
              entityId: row.id,
              beforeState: { actorType: 'account', accountId: row.accountId, revokedAt: null },
              afterState: { actorType: 'account', accountId: row.accountId, revokedAt },
              relatedIds: { accountId: row.accountId! },
              createdAt: revokedAt,
            });
          }
        });
        return null;
      }
      return {
        ...row,
        employeeId: account.employeeId,
        accountRole: 'cashier',
      };
    },
    async revokeByTokenHash(tokenHash, at) {
      return database.transaction(async (tx) => {
        const active = (await tx.select().from(authSessions).where(and(
          eq(authSessions.tokenHash, tokenHash),
          isNull(authSessions.revokedAt),
        )).for('update').limit(1))[0];
        if (!active) return false;
        await tx.update(authSessions).set({ revokedAt: at }).where(eq(authSessions.id, active.id));
        await writeAudit(tx, {
          actor: {
            type: active.actorType,
            identifier: active.actorType === 'admin'
              ? 'admin'
              : String(active.actorType === 'account' ? active.accountId : active.employeeId),
          },
          module: 'auth', action: 'logout', entityType: 'session', entityId: active.id,
          beforeState: {
            actorType: active.actorType,
            employeeId: active.employeeId,
            accountId: active.accountId,
            revokedAt: null,
          },
          afterState: {
            actorType: active.actorType,
            employeeId: active.employeeId,
            accountId: active.accountId,
            revokedAt: at,
          },
          ...(active.actorType === 'account'
            ? { relatedIds: { accountId: active.accountId! } }
            : active.employeeId === null
              ? {}
              : { relatedIds: { employeeId: active.employeeId } }),
          createdAt: at,
        });
        return true;
      });
    },
    async revokeEmployee(employeeId, at) {
      await database.transaction(async (tx) => {
        const active = await tx.select({ id: authSessions.id }).from(authSessions).where(and(
          eq(authSessions.employeeId, employeeId), isNull(authSessions.revokedAt),
        )).for('update');
        await tx.update(authSessions).set({ revokedAt: at }).where(and(
          eq(authSessions.employeeId, employeeId), isNull(authSessions.revokedAt),
        ));
        for (const session of active) await writeAudit(tx, {
          module: 'auth', action: 'session_revoke', entityType: 'session', entityId: session.id,
          relatedIds: { employeeId }, createdAt: at,
        });
      });
    },
  },
  attempts: {
    async reserveAccountLoginAttempt(input) {
      const result = await database.transaction(async (tx) => {
        const keys = loginLimitKeys(input.identifier, input.ipAddress);
        for (const key of keys) {
          await tx.insert(authLoginLimits).values({
            key,
            attemptCount: 0,
            windowStartedAt: input.now,
            updatedAt: input.now,
          }).onDuplicateKeyUpdate({ set: { key: sql`${authLoginLimits.key}` } });
        }
        const rows = await tx.select().from(authLoginLimits)
          .where(inArray(authLoginLimits.key, keys))
          .orderBy(authLoginLimits.key)
          .for('update');
        const current = rows.map((row) => (
          input.now.valueOf() - row.windowStartedAt.valueOf() >= input.windowMs
            ? { ...row, attemptCount: 0, windowStartedAt: input.now }
            : row
        ));
        const blocked = current.filter((row) => row.attemptCount >= input.maximumAttempts);
        if (blocked.length > 0) {
          for (const row of current) {
            if (row.attemptCount === 0) {
              await tx.update(authLoginLimits).set({
                attemptCount: 0,
                windowStartedAt: row.windowStartedAt,
                updatedAt: input.now,
              }).where(eq(authLoginLimits.key, row.key));
            }
          }
          return {
            allowed: false as const,
            retryAfterSeconds: Math.max(
              1,
              Math.ceil(Math.max(...blocked.map((row) => (
                row.windowStartedAt.valueOf() + input.windowMs - input.now.valueOf()
              ))) / 1000),
            ),
          };
        }
        for (const row of current) {
          await tx.update(authLoginLimits).set({
            attemptCount: row.attemptCount + 1,
            version: row.version + 1,
            windowStartedAt: row.windowStartedAt,
            updatedAt: input.now,
          }).where(eq(authLoginLimits.key, row.key));
        }
        return {
          allowed: true as const,
          reservation: current.map((row) => ({
            key: row.key,
            version: row.version + 1,
          })),
        };
      });
      const retentionMs = Math.max(input.windowMs * 2, 24 * 60 * 60_000);
      const expiredBefore = new Date(input.now.valueOf() - retentionMs);
      try {
        if (options.cleanupLoginLimits) {
          await options.cleanupLoginLimits(expiredBefore);
        } else {
          await database.transaction(async (tx) => {
            await tx.delete(authLoginLimits)
              .where(lt(authLoginLimits.updatedAt, expiredBefore))
              .orderBy(authLoginLimits.updatedAt)
              .limit(100);
          }, { isolationLevel: 'read committed' });
        }
      } catch (error) {
        options.onLoginLimitCleanupError?.(error);
      }
      return result;
    },
    async resetAccountLoginLimits(reservation) {
      await database.transaction(async (tx) => {
        for (const item of reservation.filter(({ key }) => key.startsWith('i:'))) {
          await tx.delete(authLoginLimits).where(and(
            eq(authLoginLimits.key, item.key),
            eq(authLoginLimits.version, item.version),
          ));
        }
      });
    },
    async record(attempt) {
      await database.transaction(async (tx) => {
        const id = randomUUID();
        const createdAt = now();
        await tx.insert(authAttempts).values({
          id,
          ...attempt,
          flagged: !attempt.succeeded,
          createdAt,
        });
        await writeAudit(tx, {
          actor: { type: attempt.actorType, identifier: attempt.identifier },
          module: 'auth',
          action: attempt.succeeded ? 'login_succeeded' : 'login_failed',
          entityType: 'authentication_attempt',
          entityId: id,
          afterState: { succeeded: attempt.succeeded, reason: attempt.reason },
          createdAt,
        });
      });
    },
  },
});
