import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createAuthService, createPasswordHash } from "../../../../src/modules/auth/service";

function createEmployeeAuthService() {
  return createAuthService({
    repository: {
      async findAdminByEmail() {
        return null;
      },
      async findAdminById() {
        return null;
      },
      async findEmployeeByPhone(phone: string) {
        if (phone !== "01012345678") {
          return null;
        }

        return {
          id: 2,
          fullName: "Test Employee",
          primaryPhone: "01012345678",
          passwordHash: createPasswordHash("secret123"),
          softDeletedAt: null
        };
      },
      async findEmployeeById(id: number) {
        if (id !== 2) {
          return null;
        }

        return {
          id: 2,
          fullName: "Test Employee",
          primaryPhone: "01012345678",
          passwordHash: createPasswordHash("secret123"),
          softDeletedAt: null
        };
      },
      async insertSession() {},
      async findSessionByTokenHash() {
        return null;
      },
      async revokeSessionByTokenHash() {
        return false;
      },
      async revokeActiveSessionsForActor() {}
    },
    adminSessionTtlHours: 8,
    employeeSessionTtlHours: 12
  });
}

describe("auth routes", () => {
  it("rejects invalid sign-in payloads with the project error shape", async () => {
    const app = createApp();

    const response = await request(app).post("/auth/sign-in").send({
      phone: "12345",
      password: "short"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details: expect.any(Object)
      }
    });
  });

  it("signs in an employee and sets a session cookie", async () => {
    const app = createApp({
      authService: createEmployeeAuthService()
    });

    const response = await request(app).post("/auth/sign-in").send({
      phone: "01012345678",
      password: "secret123"
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      actor: {
        id: expect.any(Number),
        role: "employee",
        name: "Test Employee",
        phone: "01012345678"
      }
    });
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringContaining("capella_session=")])
    );
  });

  it("rejects invalid admin sign-in payloads with the project error shape", async () => {
    const app = createApp();

    const response = await request(app).post("/auth/admin/sign-in").send({
      email: "not-an-email",
      password: "short"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details: expect.any(Object)
      }
    });
  });
});
