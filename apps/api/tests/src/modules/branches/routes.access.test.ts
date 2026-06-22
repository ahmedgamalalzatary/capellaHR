import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createBranchService } from "../../../../src/modules/branches/service";
import {
  InMemoryBranchRepository,
  createAdminAuthService,
  createEmployeeAuthService,
  signInEmployee
} from "./branch-routes.fixtures";

describe("branch routes (access control)", () => {
  it("returns unauthorized without an admin session", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      branchService: createBranchService({
        repository: new InMemoryBranchRepository()
      })
    });

    const response = await request(app).get("/branches");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
        details: {}
      }
    });
  });

  it("returns forbidden for employee sessions", async () => {
    const app = createApp({
      authService: createEmployeeAuthService(),
      branchService: createBranchService({
        repository: new InMemoryBranchRepository()
      })
    });
    const employeeCookie = await signInEmployee(app);

    const response = await request(app).get("/branches").set("Cookie", employeeCookie);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Admin access required",
        details: {}
      }
    });
  });
});
