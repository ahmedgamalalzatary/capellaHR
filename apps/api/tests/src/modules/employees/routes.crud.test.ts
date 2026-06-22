import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import {
  attachRequiredFiles,
  buildMultipartEmployeeRequest,
  createAdminAuthService,
  createCustomAdminAuthService,
  createEmployeeAuthService,
  createStubEmployeeService,
  signInAdmin,
  validPayload
} from "./employee-routes.fixtures";

describe("employee routes (crud)", () => {
  it("returns unauthorized for employee routes without an admin session", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("completed").service
    });

    const response = await request(app).get("/employees");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
        details: {}
      }
    });
  });

  it("returns forbidden for employee routes with an employee session", async () => {
    const authService = createEmployeeAuthService();
    const app = createApp({
      authService,
      employeeService: createStubEmployeeService("completed").service
    });

    const signInResponse = await request(app).post("/auth/sign-in").send({
      phone: "01012345678",
      password: "secret123"
    });
    const cookieHeader = signInResponse.headers["set-cookie"];

    const response = await request(app).get("/employees").set("Cookie", cookieHeader);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Admin access required",
        details: {}
      }
    });
  });

  it("rejects invalid employee creation payloads with the project error shape", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .post("/employees")
      .set("Cookie", cookieHeader)
      .field("fullName", "")
      .field("password", "short");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details: expect.any(Object)
      }
    });
  });

  it("rejects employee creation for setup pending branches", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("setup_pending").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await attachRequiredFiles(
      buildMultipartEmployeeRequest(request(app).post("/employees").set("Cookie", cookieHeader), validPayload())
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: "BRANCH_NOT_ASSIGNABLE",
        message: "Employees can only be assigned to completed branches",
        details: {}
      }
    });
  });

  it("creates an employee for completed branches", async () => {
    const employeeService = createStubEmployeeService("completed");
    const app = createApp({
      authService: createCustomAdminAuthService(7),
      employeeService: employeeService.service
    });
    const cookieHeader = await signInAdmin(app, {
      email: "admin7@capella.eg",
      password: "admin1234"
    });

    const response = await attachRequiredFiles(
      buildMultipartEmployeeRequest(request(app).post("/employees").set("Cookie", cookieHeader), validPayload())
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      employee: {
        id: 1,
        fullName: "Mina Adel",
        primaryPhone: "01012345678",
        whatsappPhone: "01012345679",
        email: "mina@capella.eg",
        branchId: 1,
        age: 28,
        address: "Cairo",
        currentMonthlySalary: "10000",
        softDeletedAt: null
      }
    });
    expect(employeeService.state.lastCreatedByAdminId).toBe(7);
  });

  it("rejects employee creation when the required files are missing", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await buildMultipartEmployeeRequest(
      request(app).post("/employees").set("Cookie", cookieHeader),
      validPayload()
    ).attach("personalPhoto", Buffer.from("photo"), "photo.jpg");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "MISSING_EMPLOYEE_FILES",
        message: "Employee files are required",
        details: {
          missingFileTypes: ["id_front", "id_back"]
        }
      }
    });
  });

  it("lists employees using the shared query filter contract", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).get("/employees").set("Cookie", cookieHeader).query({
      page: "1",
      pageSize: "10",
      search: "Mina",
      branchId: "1",
      status: "active"
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      employees: {
        items: [
          {
            id: 1,
            fullName: "Mina Adel",
            primaryPhone: "01012345678",
            whatsappPhone: "01012345679",
            email: "mina@capella.eg",
            branchId: 1,
            age: 28,
            address: "Cairo",
            currentMonthlySalary: "10000",
            softDeletedAt: null
          }
        ],
        pagination: {
          page: 1,
          pageSize: 10,
          total: 1,
          totalPages: 1
        }
      }
    });
  });

  it("returns a single employee by id", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).get("/employees/1").set("Cookie", cookieHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      employee: {
        id: 1,
        fullName: "Mina Adel",
        primaryPhone: "01012345678",
        whatsappPhone: "01012345679",
        email: "mina@capella.eg",
        branchId: 1,
        age: 28,
        address: "Cairo",
        currentMonthlySalary: "10000",
        softDeletedAt: null
      }
    });
  });

  it("returns not found for a missing employee id", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).get("/employees/999").set("Cookie", cookieHeader);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "EMPLOYEE_NOT_FOUND",
        message: "Employee not found",
        details: {}
      }
    });
  });

  it("updates an employee", async () => {
    const employeeService = createStubEmployeeService("completed");
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: employeeService.service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).patch("/employees/1").set("Cookie", cookieHeader).send({
      fullName: "Updated Mina",
      currentMonthlySalary: "12000"
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      employee: {
        id: 1,
        fullName: "Updated Mina",
        primaryPhone: "01012345678",
        whatsappPhone: "01012345679",
        email: "mina@capella.eg",
        branchId: 1,
        age: 28,
        address: "Cairo",
        currentMonthlySalary: "12000",
        softDeletedAt: null
      }
    });
    expect(employeeService.state.lastUpdatedByAdminId).toBe(1);
  });

  it("returns validation errors for invalid employee updates", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).patch("/employees/1").set("Cookie", cookieHeader).send({
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

  it("returns conflict errors for duplicate employee updates", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).patch("/employees/1").set("Cookie", cookieHeader).send({
      email: "duplicate@capella.eg"
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: "EMPLOYEE_CONFLICT",
        message: "Employee email must be unique",
        details: {
          field: "email"
        }
      }
    });
  });

  it("soft deletes an employee", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).delete("/employees/1").set("Cookie", cookieHeader);

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
  });
});
