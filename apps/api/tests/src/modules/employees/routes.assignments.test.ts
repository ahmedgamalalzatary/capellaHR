import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import {
  createAdminAuthService,
  createStubEmployeeService,
  signInAdmin
} from "./employee-routes.fixtures";

describe("employee routes (branch assignments)", () => {
  it("creates a branch assignment for admins", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const adminCookie = await signInAdmin(app);
    const effectiveFrom = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const response = await request(app)
      .post("/employees/1/branch-assignments")
      .set("Cookie", adminCookie)
      .send({
        branchId: 2,
        effectiveFrom
      });

    expect(response.status).toBe(201);
    expect(response.body.assignment.branchId).toBe(2);
    expect(response.body.assignment.effectiveFrom).toBe(effectiveFrom);
  });

  it("lists employee branch assignments for admins", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const adminCookie = await signInAdmin(app);

    const response = await request(app)
      .get("/employees/1/branch-assignments")
      .set("Cookie", adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.assignments).toHaveLength(1);
  });
});
