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
