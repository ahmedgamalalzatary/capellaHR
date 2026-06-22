import type { MySql2Database } from "drizzle-orm/mysql2";
import { createPasswordHash } from "./service";
import { type AdminRecord, findAdminByEmail, findAdminById } from "./admin-auth.repository";
import { type EmployeeRecord, findEmployeeById, findEmployeeByPhone } from "./employee-auth.repository";
import {
  findSessionByTokenHash,
  insertSession,
  revokeActiveSessionsForActor,
  revokeSessionByTokenHash,
  type SessionRecord
} from "./session.repository";

export type { AdminRecord } from "./admin-auth.repository";
export type { EmployeeRecord } from "./employee-auth.repository";
export type { SessionRecord } from "./session.repository";
export { syncBootstrapAdmin } from "./bootstrap-admin.repository";

export type AuthRepository = {
  findAdminByEmail(email: string): Promise<AdminRecord | null>;
  findAdminById(id: number): Promise<AdminRecord | null>;
  findEmployeeByPhone(phone: string): Promise<EmployeeRecord | null>;
  findEmployeeById(id: number): Promise<EmployeeRecord | null>;
  insertSession(session: SessionRecord): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<boolean>;
  revokeActiveSessionsForActor(
    actorRole: "admin" | "employee",
    actorId: number,
    revokedAt: Date
  ): Promise<void>;
};

type DatabaseSchema = typeof import("../../db/schema");

type CreateInMemoryAuthRepositoryOptions = {
  bootstrapAdmin: {
    name: string;
    email: string;
    password: string;
  };
};

class InMemoryAuthRepository implements AuthRepository {
  private readonly admin: AdminRecord;
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(options: CreateInMemoryAuthRepositoryOptions) {
    this.admin = {
      id: 1,
      name: options.bootstrapAdmin.name,
      email: options.bootstrapAdmin.email.trim().toLowerCase(),
      passwordHash: createPasswordHash(options.bootstrapAdmin.password)
    };
  }

  async findAdminByEmail(email: string) {
    if (this.admin.email !== email.trim().toLowerCase()) {
      return null;
    }

    return this.admin;
  }

  async findAdminById(id: number) {
    if (this.admin.id !== id) {
      return null;
    }

    return this.admin;
  }

  async findEmployeeByPhone(_phone: string) {
    void _phone;
    return null;
  }

  async findEmployeeById(_id: number) {
    void _id;
    return null;
  }

  async insertSession(session: SessionRecord) {
    this.sessions.set(session.tokenHash, session);
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }

  async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date) {
    const session = this.sessions.get(tokenHash);

    if (!session) {
      return false;
    }

    this.sessions.set(tokenHash, {
      ...session,
      revokedAt
    });
    return true;
  }

  async revokeActiveSessionsForActor(actorRole: "admin" | "employee", actorId: number, revokedAt: Date) {
    for (const session of this.sessions.values()) {
      if (
        session.actorRole === actorRole &&
        session.actorId === actorId &&
        session.revokedAt === null &&
        session.expiresAt.getTime() > revokedAt.getTime()
      ) {
        session.revokedAt = revokedAt;
      }
    }
  }
}

export function createInMemoryAuthRepository(options: CreateInMemoryAuthRepositoryOptions) {
  return new InMemoryAuthRepository(options);
}

type CreateDrizzleAuthRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

export type DrizzleAuthRepository = AuthRepository & {
  db: MySql2Database<DatabaseSchema>;
};

export function createDrizzleAuthRepository(options: CreateDrizzleAuthRepositoryOptions): DrizzleAuthRepository {
  const { db } = options;

  return {
    db,
    findAdminByEmail: (email) => findAdminByEmail(db, email),
    findAdminById: (id) => findAdminById(db, id),
    findEmployeeByPhone: (phone) => findEmployeeByPhone(db, phone),
    findEmployeeById: (id) => findEmployeeById(db, id),
    insertSession: (session) => insertSession(db, session),
    findSessionByTokenHash: (tokenHash) => findSessionByTokenHash(db, tokenHash),
    revokeSessionByTokenHash: (tokenHash, revokedAt) => revokeSessionByTokenHash(db, tokenHash, revokedAt),
    revokeActiveSessionsForActor: (actorRole, actorId, revokedAt) =>
      revokeActiveSessionsForActor(db, actorRole, actorId, revokedAt)
  };
}
