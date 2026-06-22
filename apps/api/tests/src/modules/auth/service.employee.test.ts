import { describe, expect, it } from "vitest";
import { createAuthService, createPasswordHash } from "../../../../src/modules/auth/service";
import { InMemoryAuthRepository } from "./auth-service.fixtures";

describe("auth service (employee)", () => {
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
