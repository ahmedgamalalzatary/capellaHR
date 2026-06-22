import type {
  AdminRecord,
  AuthRepository,
  EmployeeRecord,
  SessionRecord
} from "../../../../src/modules/auth/service";

export class InMemoryAuthRepository implements AuthRepository {
  admin: AdminRecord | null = null;
  employee: EmployeeRecord | null = null;
  sessions: SessionRecord[] = [];

  async findAdminByEmail(email: string) {
    if (this.admin?.email !== email) {
      return null;
    }

    return this.admin;
  }

  async findAdminById(id: number) {
    if (this.admin?.id !== id) {
      return null;
    }

    return this.admin;
  }

  async findEmployeeByPhone(phone: string) {
    if (this.employee?.primaryPhone !== phone) {
      return null;
    }

    return this.employee;
  }

  async findEmployeeById(id: number) {
    if (this.employee?.id !== id) {
      return null;
    }

    return this.employee;
  }

  async insertSession(session: SessionRecord) {
    this.sessions.push(session);
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this.sessions.find((session) => session.tokenHash === tokenHash) ?? null;
  }

  async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date) {
    const session = this.sessions.find((item) => item.tokenHash === tokenHash);

    if (!session) {
      return false;
    }

    session.revokedAt = revokedAt;
    return true;
  }

  async revokeActiveSessionsForActor(actorRole: "admin" | "employee", actorId: number, revokedAt: Date) {
    for (const session of this.sessions) {
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
