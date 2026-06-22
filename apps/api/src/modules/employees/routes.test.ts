import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { createEmployeeService } from "./service";

function createStubEmployeeService(branchSetupStatus: "completed" | "setup_pending") {
  return createEmployeeService({
    repository: {
      async findBranchSetupStatus() {
        return branchSetupStatus;
      },
      async createEmployee(input) {
        return {
          id: 1,
          fullName: input.fullName,
          passwordHash: input.passwordHash,
          primaryPhone: input.primaryPhone,
          whatsappPhone: input.whatsappPhone,
          email: input.email ?? null,
          branchId: input.branchId,
          age: input.age,
          address: input.address,
          currentMonthlySalary: input.currentMonthlySalary,
          softDeletedAt: null
        };
      },
      async listEmployees() {
        return [
          {
            id: 1,
            fullName: "Mina Adel",
            passwordHash: "plain:secret123",
            primaryPhone: "01012345678",
            whatsappPhone: "01012345679",
            email: "mina@capella.eg",
            branchId: 1,
            age: 28,
            address: "Cairo",
            currentMonthlySalary: "10000",
            softDeletedAt: null
          }
        ];
      },
      async findEmployeeById(employeeId) {
        if (employeeId !== 1) {
          return null;
        }

        return {
          id: 1,
          fullName: "Mina Adel",
          passwordHash: "plain:secret123",
          primaryPhone: "01012345678",
          whatsappPhone: "01012345679",
          email: "mina@capella.eg",
          branchId: 1,
          age: 28,
          address: "Cairo",
          currentMonthlySalary: "10000",
          softDeletedAt: null
        };
      },
      async updateEmployee(employeeId, input) {
        if (employeeId !== 1) {
          return null;
        }

        if (input.email === "duplicate@capella.eg") {
          return {
            error: {
              code: "EMPLOYEE_CONFLICT",
              field: "email"
            }
          };
        }

        return {
          id: 1,
          fullName: input.fullName ?? "Mina Adel",
          passwordHash: input.passwordHash ?? "plain:secret123",
          primaryPhone: input.primaryPhone ?? "01012345678",
          whatsappPhone: input.whatsappPhone ?? "01012345679",
          email: input.email ?? "mina@capella.eg",
          branchId: input.branchId ?? 1,
          age: input.age ?? 28,
          address: input.address ?? "Cairo",
          currentMonthlySalary: input.currentMonthlySalary ?? "10000",
          softDeletedAt: null
        };
      },
      async softDeleteEmployee(employeeId) {
        return employeeId === 1;
      }
    }
  });
}

describe("employee routes", () => {
  it("rejects invalid employee creation payloads with the project error shape", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).post("/employees").send({
      fullName: "",
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

  it("rejects employee creation for setup pending branches", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("setup_pending")
    });

    const response = await request(app).post("/employees").send(validPayload());

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
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).post("/employees").send(validPayload());

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
  });

  it("lists employees using the shared query filter contract", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).get("/employees").query({
      search: "Mina",
      branchId: "1",
      status: "active"
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      employees: [
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
      ]
    });
  });

  it("returns a single employee by id", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).get("/employees/1");

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
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).get("/employees/999");

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
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).patch("/employees/1").send({
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
  });

  it("returns validation errors for invalid employee updates", async () => {
    const app = createApp({
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).patch("/employees/1").send({
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
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).patch("/employees/1").send({
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
      employeeService: createStubEmployeeService("completed")
    });

    const response = await request(app).delete("/employees/1");

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
  });
});

function validPayload() {
  return {
    fullName: "Mina Adel",
    password: "secret123",
    primaryPhone: "01012345678",
    whatsappPhone: "01012345679",
    email: "mina@capella.eg",
    branchId: 1,
    age: 28,
    address: "Cairo",
    currentMonthlySalary: "10000"
  };
}
