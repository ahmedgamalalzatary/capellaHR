import { describe, expect, it } from "vitest";
import {
  createPasswordHash,
  createAuthService,
  type AdminRecord,
  type AuthRepository,
  type EmployeeRecord,
  type SessionRecord
} from "../../../../src/modules/auth/service";

class InMemoryAuthRepository implements AuthRepository {
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

describe("auth service", () => {
  it("creates an admin session for valid admin credentials", async () => {
    const repository = new InMemoryAuthRepository();
    repository.admin = {
      id: 1,
      name: "Capella Admin",
      email: "admin@capella.eg",
      passwordHash: "plain:admin1234"
    };

    const service = createAuthService({
      repository,
      adminSessionTtlHours: 8
    });

    const result = await service.signInAdmin({
      email: "admin@capella.eg",
      password: "admin1234"
    });

    expect(result).toEqual({
      sessionToken: expect.any(String),
      actor: {
        id: 1,
        role: "admin",
        name: "Capella Admin",
        email: "admin@capella.eg"
      },
      expiresAt: expect.any(Date)
    });
    expect(repository.sessions).toHaveLength(1);
    expect(repository.sessions[0]).toEqual({
      tokenHash: expect.any(String),
      actorId: 1,
      actorRole: "admin",
      expiresAt: expect.any(Date),
      revokedAt: null
    });
  });

  it("rejects invalid admin credentials", async () => {
    const repository = new InMemoryAuthRepository();
    repository.admin = {
      id: 1,
      name: "Capella Admin",
      email: "admin@capella.eg",
      passwordHash: "plain:admin1234"
    };

    const service = createAuthService({
      repository,
      adminSessionTtlHours: 8
    });

    const result = await service.signInAdmin({
      email: "admin@capella.eg",
      password: "wrong-password"
    });

    expect(result).toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
        details: {}
      }
    });
    expect(repository.sessions).toHaveLength(0);
  });

  it("returns the current admin session actor for a valid session token", async () => {
    const repository = new InMemoryAuthRepository();
    repository.admin = {
      id: 1,
      name: "Capella Admin",
      email: "admin@capella.eg",
      passwordHash: "plain:admin1234"
    };

    const service = createAuthService({
      repository,
      adminSessionTtlHours: 8
    });

    const signedIn = await service.signInAdmin({
      email: "admin@capella.eg",
      password: "admin1234"
    });

    if ("error" in signedIn) {
      throw new Error("expected sign-in to succeed");
    }

    const result = await service.getAdminSessionActor(signedIn.sessionToken);

    expect(result).toEqual({
      id: 1,
      role: "admin",
      name: "Capella Admin",
      email: "admin@capella.eg"
    });
  });

  it("revokes an admin session token on sign-out", async () => {
    const repository = new InMemoryAuthRepository();
    repository.admin = {
      id: 1,
      name: "Capella Admin",
      email: "admin@capella.eg",
      passwordHash: "plain:admin1234"
    };

    const service = createAuthService({
      repository,
      adminSessionTtlHours: 8
    });

    const signedIn = await service.signInAdmin({
      email: "admin@capella.eg",
      password: "admin1234"
    });

    if ("error" in signedIn) {
      throw new Error("expected sign-in to succeed");
    }

    const result = await service.signOut(signedIn.sessionToken);

    expect(result).toEqual({ revoked: true });
    expect(repository.sessions[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it("creates an employee session and revokes the previous active employee session", async () => {
    const repository = new InMemoryAuthRepository();
    repository.employee = {
      id: 7,
      fullName: "Mina Adel",
      primaryPhone: "01012345678",
      passwordHash: createPasswordHash("secret123"),
      softDeletedAt: null
    };

    const service = createAuthService({
      repository,
      adminSessionTtlHours: 8,
      employeeSessionTtlHours: 12
    });

    const firstSignIn = await service.signInEmployee({
      phone: "01012345678",
      password: "secret123"
    });

    if ("error" in firstSignIn) {
      throw new Error("expected first employee sign-in to succeed");
    }

    const secondSignIn = await service.signInEmployee({
      phone: "01012345678",
      password: "secret123"
    });

    if ("error" in secondSignIn) {
      throw new Error("expected second employee sign-in to succeed");
    }

    expect(firstSignIn.actor).toEqual({
      id: 7,
      role: "employee",
      name: "Mina Adel",
      phone: "01012345678"
    });
    expect(secondSignIn.actor).toEqual({
      id: 7,
      role: "employee",
      name: "Mina Adel",
      phone: "01012345678"
    });
    expect(repository.sessions).toHaveLength(2);
    expect(repository.sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(repository.sessions[1]?.revokedAt).toBeNull();
  });
});
