import { and, eq, gt, isNull } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { adminSessions, employeeSessions } from "../../db";

type DatabaseSchema = typeof import("../../db/schema");
type Db = MySql2Database<DatabaseSchema>;

export type SessionRecord = {
  tokenHash: string;
  actorId: number;
  actorRole: "admin" | "employee";
  expiresAt: Date;
  revokedAt: Date | null;
};

export async function insertSession(db: Db, session: SessionRecord): Promise<void> {
  if (session.actorRole === "admin") {
    await db.insert(adminSessions).values({
      adminId: session.actorId,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt
    });
    return;
  }

  await db.insert(employeeSessions).values({
    employeeId: session.actorId,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt
  });
}

export async function findSessionByTokenHash(db: Db, tokenHash: string): Promise<SessionRecord | null> {
  const adminRows = await db
    .select({
      tokenHash: adminSessions.tokenHash,
      actorId: adminSessions.adminId,
      expiresAt: adminSessions.expiresAt,
      revokedAt: adminSessions.revokedAt
    })
    .from(adminSessions)
    .where(eq(adminSessions.tokenHash, tokenHash))
    .limit(1);

  if (adminRows[0]) {
    return {
      ...adminRows[0],
      actorRole: "admin"
    } satisfies SessionRecord;
  }

  const employeeRows = await db
    .select({
      tokenHash: employeeSessions.tokenHash,
      actorId: employeeSessions.employeeId,
      expiresAt: employeeSessions.expiresAt,
      revokedAt: employeeSessions.revokedAt
    })
    .from(employeeSessions)
    .where(eq(employeeSessions.tokenHash, tokenHash))
    .limit(1);

  if (employeeRows[0]) {
    return {
      ...employeeRows[0],
      actorRole: "employee"
    } satisfies SessionRecord;
  }

  return null;
}

export async function revokeSessionByTokenHash(db: Db, tokenHash: string, revokedAt: Date): Promise<boolean> {
  const adminResult = await db
    .update(adminSessions)
    .set({ revokedAt })
    .where(eq(adminSessions.tokenHash, tokenHash));

  if (adminResult[0].affectedRows > 0) {
    return true;
  }

  const employeeResult = await db
    .update(employeeSessions)
    .set({ revokedAt })
    .where(eq(employeeSessions.tokenHash, tokenHash));

  return employeeResult[0].affectedRows > 0;
}

export async function revokeActiveSessionsForActor(
  db: Db,
  actorRole: "admin" | "employee",
  actorId: number,
  revokedAt: Date
): Promise<void> {
  if (actorRole === "admin") {
    await db
      .update(adminSessions)
      .set({ revokedAt })
      .where(
        and(
          eq(adminSessions.adminId, actorId),
          isNull(adminSessions.revokedAt),
          gt(adminSessions.expiresAt, revokedAt)
        )
      );
    return;
  }

  await db
    .update(employeeSessions)
    .set({ revokedAt })
    .where(
      and(
        eq(employeeSessions.employeeId, actorId),
        isNull(employeeSessions.revokedAt),
        gt(employeeSessions.expiresAt, revokedAt)
      )
    );
}
