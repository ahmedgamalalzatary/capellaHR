import { and, eq, gt, isNull } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import {
  adminSessions,
  admins,
  employeeSessions,
  employees
} from "../../db";
import { createPasswordHash } from "./service";

export type AdminRecord = {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
};

export type EmployeeRecord = {
  id: number;
  fullName: string;
  primaryPhone: string;
  passwordHash: string;
  softDeletedAt: Date | null;
};

export type SessionRecord = {
  tokenHash: string;
  actorId: number;
  actorRole: "admin" | "employee";
  expiresAt: Date;
  revokedAt: Date | null;
};

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

type DrizzleAuthRepository = AuthRepository & {
  db: MySql2Database<DatabaseSchema>;
};

export function createDrizzleAuthRepository(options: CreateDrizzleAuthRepositoryOptions): DrizzleAuthRepository {
  return {
    db: options.db,
    async findAdminByEmail(email: string) {
      const rows = await options.db
        .select({
          id: admins.id,
          name: admins.name,
          email: admins.email,
          passwordHash: admins.passwordHash
        })
        .from(admins)
        .where(eq(admins.email, email.trim().toLowerCase()))
        .limit(1);

      return rows[0] ?? null;
    },

    async findAdminById(id: number) {
      const rows = await options.db
        .select({
          id: admins.id,
          name: admins.name,
          email: admins.email,
          passwordHash: admins.passwordHash
        })
        .from(admins)
        .where(eq(admins.id, id))
        .limit(1);

      return rows[0] ?? null;
    },

    async findEmployeeByPhone(phone: string) {
      const rows = await options.db
        .select({
          id: employees.id,
          fullName: employees.fullName,
          primaryPhone: employees.primaryPhone,
          passwordHash: employees.passwordHash,
          softDeletedAt: employees.softDeletedAt
        })
        .from(employees)
        .where(eq(employees.primaryPhone, phone))
        .limit(1);

      return rows[0] ?? null;
    },

    async findEmployeeById(id: number) {
      const rows = await options.db
        .select({
          id: employees.id,
          fullName: employees.fullName,
          primaryPhone: employees.primaryPhone,
          passwordHash: employees.passwordHash,
          softDeletedAt: employees.softDeletedAt
        })
        .from(employees)
        .where(eq(employees.id, id))
        .limit(1);

      return rows[0] ?? null;
    },

    async insertSession(session: SessionRecord) {
      if (session.actorRole === "admin") {
        await options.db.insert(adminSessions).values({
          adminId: session.actorId,
          tokenHash: session.tokenHash,
          expiresAt: session.expiresAt,
          revokedAt: session.revokedAt
        });
        return;
      }

      await options.db.insert(employeeSessions).values({
        employeeId: session.actorId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt
      });
    },

    async findSessionByTokenHash(tokenHash: string) {
      const adminRows = await options.db
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

      const employeeRows = await options.db
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
    },

    async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date) {
      const adminResult = await options.db
        .update(adminSessions)
        .set({ revokedAt })
        .where(eq(adminSessions.tokenHash, tokenHash));

      if (adminResult[0].affectedRows > 0) {
        return true;
      }

      const employeeResult = await options.db
        .update(employeeSessions)
        .set({ revokedAt })
        .where(eq(employeeSessions.tokenHash, tokenHash));

      return employeeResult[0].affectedRows > 0;
    },

    async revokeActiveSessionsForActor(actorRole: "admin" | "employee", actorId: number, revokedAt: Date) {
      if (actorRole === "admin") {
        await options.db
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

      await options.db
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
  };
}

type BootstrapAdminInput = {
  name: string;
  email: string;
  password: string;
};

export async function syncBootstrapAdmin(repository: AuthRepository, input: BootstrapAdminInput) {
  const email = input.email.trim().toLowerCase();
  const existingAdmin = await repository.findAdminByEmail(email);

  if (existingAdmin) {
    return existingAdmin;
  }

  if (!("db" in repository)) {
    throw new Error("Bootstrap admin sync requires a database-backed auth repository");
  }

  const drizzleRepository = repository as DrizzleAuthRepository;
  const passwordHash = createPasswordHash(input.password);

  await drizzleRepository.db.insert(admins).values({
    name: input.name,
    email,
    passwordHash
  });

  const admin = await repository.findAdminByEmail(email);

  if (!admin) {
    throw new Error("Failed to load bootstrap admin after insert");
  }

  return admin;
}
