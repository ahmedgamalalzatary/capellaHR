import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService } from "../../../../src/modules/auth/service";

function createAdminAuthService() {
  return createAuthService({
    repository: createInMemoryAuthRepository({
      bootstrapAdmin: {
        name: "Capella Admin",
        email: "admin.test@capella.invalid",
        password: "test-admin-pass-123"
      }
    }),
    adminSessionTtlHours: 8,
    employeeSessionTtlHours: 12
  });
}

describe("admin auth routes", () => {
  it("signs in an admin, sets a session cookie, returns the current admin, and clears the cookie on sign-out", async () => {
    const app = createApp({
      authService: createAdminAuthService()
    });

    const signInResponse = await request(app).post("/auth/admin/sign-in").send({
      email: "admin.test@capella.invalid",
      password: "test-admin-pass-123"
    });

    expect(signInResponse.status).toBe(200);
    expect(signInResponse.body).toEqual({
      actor: {
        id: expect.any(Number),
        role: "admin",
        name: "Capella Admin",
        email: "admin.test@capella.invalid"
      }
    });

    const cookieHeader = signInResponse.headers["set-cookie"];

    expect(cookieHeader).toEqual(
      expect.arrayContaining([expect.stringContaining("capella_session=")])
    );

    const meResponse = await request(app).get("/auth/me").set("Cookie", cookieHeader);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body).toEqual({
      actor: {
        id: expect.any(Number),
        role: "admin",
        name: "Capella Admin",
        email: "admin.test@capella.invalid"
      }
    });

    const signOutResponse = await request(app)
      .post("/auth/sign-out")
      .set("Cookie", cookieHeader);

    expect(signOutResponse.status).toBe(204);
    expect(signOutResponse.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringContaining("capella_session=;")])
    );
  });

  it("returns unauthorized for auth me without a session cookie", async () => {
    const app = createApp({
      authService: createAdminAuthService()
    });

    const response = await request(app).get("/auth/me");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
        details: {}
      }
    });
  });
});
