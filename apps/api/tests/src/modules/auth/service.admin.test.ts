import { describe, expect, it } from "vitest";
import { createAuthService } from "../../../../src/modules/auth/service";
import { InMemoryAuthRepository } from "./auth-service.fixtures";

describe("auth service (admin)", () => {
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
});
