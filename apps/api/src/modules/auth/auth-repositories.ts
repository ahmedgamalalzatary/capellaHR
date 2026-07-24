import { randomUUID } from 'node:crypto';

import { type createDatabase } from '@capella/database';
import { adminCredentials, authAttempts, authSessions, employees } from '@capella/database/schema';
import { and, eq, isNull, or } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import type { AdminCredentialRepository, AttemptRepository, SessionRepository } from './auth-service.js';

type Database = ReturnType<typeof createDatabase>;

export const createDrizzleAuthRepositories = (
  database: Database,
  now: () => Date = () => new Date(),
): { adminCredentials: AdminCredentialRepository; sessions: SessionRepository; attempts: AttemptRepository } => ({
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
      const rows = await database.select({
        id: authSessions.id,
        tokenHash: authSessions.tokenHash,
        actorType: authSessions.actorType,
        employeeId: authSessions.employeeId,
        revokedAt: authSessions.revokedAt,
      }).from(authSessions)
        .leftJoin(employees, eq(employees.id, authSessions.employeeId))
        .where(and(
          eq(authSessions.tokenHash, tokenHash),
          isNull(authSessions.revokedAt),
          or(
            eq(authSessions.actorType, 'admin'),
            and(
              eq(employees.employmentStatus, 'active'),
              isNull(employees.deletedAt),
            ),
          ),
        )).limit(1);
      const row = rows[0];
      return row
        ? {
            id: row.id,
            tokenHash: row.tokenHash,
            actorType: row.actorType,
            employeeId: row.employeeId,
            revokedAt: row.revokedAt,
          }
        : null;
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
            identifier: active.actorType === 'admin' ? 'admin' : String(active.employeeId),
          },
          module: 'auth', action: 'logout', entityType: 'session', entityId: active.id,
          beforeState: { actorType: active.actorType, employeeId: active.employeeId, revokedAt: null },
          afterState: { actorType: active.actorType, employeeId: active.employeeId, revokedAt: at },
          ...(active.employeeId === null ? {} : { relatedIds: { employeeId: active.employeeId } }),
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
