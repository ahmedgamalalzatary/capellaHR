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
