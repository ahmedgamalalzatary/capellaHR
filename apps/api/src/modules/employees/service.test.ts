import { describe, expect, it } from "vitest";
import type { EmployeeCreateInput } from "@capella/shared";
import { createEmployeeService, type EmployeeRepository } from "./service";

class InMemoryEmployeeRepository implements EmployeeRepository {
  branchSetupStatus: "completed" | "setup_pending" | null = "completed";
  createdEmployee: unknown = null;

  async findBranchSetupStatus() {
    return this.branchSetupStatus;
  }

  async createEmployee(input: {
    fullName: string;
    passwordHash: string;
    primaryPhone: string;
    whatsappPhone: string;
    email?: string;
    branchId: number;
    age: number;
    address: string;
    currentMonthlySalary: string;
    createdByAdminId: number;
  }) {
    this.createdEmployee = input;

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

describe("employee service", () => {
  it("rejects employee creation for setup pending branches", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.branchSetupStatus = "setup_pending";

    const service = createEmployeeService({
      repository
    });

    const result = await service.createEmployee(createInput(), 1);

    expect(result).toEqual({
      error: {
        code: "BRANCH_NOT_ASSIGNABLE",
        message: "Employees can only be assigned to completed branches",
        details: {}
      }
    });
  });

  it("hashes the password and creates an employee for completed branches", async () => {
    const repository = new InMemoryEmployeeRepository();
    const service = createEmployeeService({
      repository
    });

    const result = await service.createEmployee(createInput(), 1);

    expect(result).toEqual({
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
    });
    expect(repository.createdEmployee).toMatchObject({
      passwordHash: expect.stringMatching(/^scrypt\$/)
    });
  });
});

function createInput(): EmployeeCreateInput {
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
