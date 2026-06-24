import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import {
  createAdminAuthService,
  createEmployeeAuthService,
  signInAdmin,
  signInEmployee
} from "../branches/branch-routes.fixtures";

describe("network routes (GET /network/whoami)", () => {
  it("returns the IP from x-forwarded-for for an admin session", async () => {
    const app = createApp({ authService: createAdminAuthService() });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .get("/network/whoami")
      .set("Cookie", adminCookie)
      .set("x-forwarded-for", "203.0.113.7");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ip: "203.0.113.7" });
  });

  it("falls back to the request IP when no forwarded header is present", async () => {
    const app = createApp({ authService: createAdminAuthService() });
    const adminCookie = await signInAdmin(app);

    const response = await request(app).get("/network/whoami").set("Cookie", adminCookie);

    expect(response.status).toBe(200);
    expect(typeof response.body.ip).toBe("string");
    expect(response.body.ip.length).toBeGreaterThan(0);
  });

  it("returns unauthorized without an admin session", async () => {
    const app = createApp({ authService: createAdminAuthService() });

    const response = await request(app).get("/network/whoami");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication required", details: {} }
    });
  });

  it("returns forbidden for employee sessions", async () => {
    const app = createApp({ authService: createEmployeeAuthService() });
    const employeeCookie = await signInEmployee(app);

    const response = await request(app).get("/network/whoami").set("Cookie", employeeCookie);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: { code: "FORBIDDEN", message: "Admin access required", details: {} }
    });
  });
});
