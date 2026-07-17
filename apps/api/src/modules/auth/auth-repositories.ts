import { randomUUID } from 'node:crypto';

import { type createDatabase } from '@capella/database';
import { authAttempts, authSessions } from '@capella/database/schema';
import { and, eq, isNull } from 'drizzle-orm';

import type { AttemptRepository, SessionRepository } from './auth-service.js';

type Database = ReturnType<typeof createDatabase>;

export const createDrizzleAuthRepositories = (
  database: Database,
  now: () => Date = () => new Date(),
): { sessions: SessionRepository; attempts: AttemptRepository } => ({
  sessions: {
    async create(session) {
      await database.insert(authSessions).values({ ...session, createdAt: now() });
    },
    async findActiveByTokenHash(tokenHash) {
      const rows = await database.select().from(authSessions).where(and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
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
      const active = await database.select({ id: authSessions.id }).from(authSessions).where(and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
      )).limit(1);
      if (!active[0]) return false;
      await database.update(authSessions).set({ revokedAt: at }).where(eq(authSessions.id, active[0].id));
      return true;
    },
    async revokeEmployee(employeeId, at) {
      await database.update(authSessions).set({ revokedAt: at }).where(and(
        eq(authSessions.employeeId, employeeId),
        isNull(authSessions.revokedAt),
      ));
    },
  },
  attempts: {
    async record(attempt) {
      await database.insert(authAttempts).values({
        id: randomUUID(),
        ...attempt,
        flagged: !attempt.succeeded,
        createdAt: now(),
      });
    },
  },
});
