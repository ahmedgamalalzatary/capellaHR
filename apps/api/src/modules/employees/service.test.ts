import { describe, expect, it } from "vitest";
import type { EmployeeCreateInput, EmployeeListFilterInput } from "@capella/shared";
import { createEmployeeService, type EmployeeRepository } from "./service";
import type { EmployeeConflictField, EmployeeConflictResult, EmployeeRecord } from "./repository";

class InMemoryEmployeeRepository implements EmployeeRepository {
  branchSetupStatus: "completed" | "setup_pending" | null = "completed";
  createdEmployee: unknown = null;
  employees: EmployeeRecord[] = [
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
  nextCreateError: "primary_phone" | "whatsapp_phone" | "email" | null = null;
  nextUpdateError: "primary_phone" | "whatsapp_phone" | "email" | null = null;

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

    if (this.nextCreateError) {
      return createConflict(this.nextCreateError);
    }

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

  async listEmployees(filters: EmployeeListFilterInput) {
    return this.employees.filter((employee) => {
      if (filters.search && !employee.fullName.toLowerCase().includes(filters.search.toLowerCase())) {
        return false;
      }

      if (typeof filters.branchId === "number" && employee.branchId !== filters.branchId) {
        return false;
      }

      if (filters.status === "active" && employee.softDeletedAt) {
        return false;
      }

      if (filters.status === "soft_deleted" && !employee.softDeletedAt) {
        return false;
      }

      return true;
    });
  }

  async findEmployeeById(employeeId: number) {
    return this.employees.find((employee) => employee.id === employeeId) ?? null;
  }

  async updateEmployee(employeeId: number, input: {
    fullName?: string;
    passwordHash?: string;
    primaryPhone?: string;
    whatsappPhone?: string;
    email?: string;
    branchId?: number;
    age?: number;
    address?: string;
    currentMonthlySalary?: string;
  }, updatedByAdminId: number) {
    void updatedByAdminId;

    const existing = this.employees.find((employee) => employee.id === employeeId);

    if (!existing) {
      return null;
    }

    if (this.nextUpdateError) {
      return createConflict(this.nextUpdateError);
    }

    const updates = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined)
    );

    Object.assign(existing, updates);
    return existing;
  }

  async softDeleteEmployee(employeeId: number) {
    const existing = this.employees.find((employee) => employee.id === employeeId);

    if (!existing) {
      return false;
    }

    existing.softDeletedAt = new Date();
    return true;
  }
}

function createConflict(field: EmployeeConflictField): EmployeeConflictResult {
  return {
    error: {
      code: "EMPLOYEE_CONFLICT",
      field
    }
  };
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

  it("maps duplicate employee fields into a conflict error during creation", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.nextCreateError = "primary_phone";
    const service = createEmployeeService({
      repository
    });

    const result = await service.createEmployee(createInput(), 1);

    expect(result).toEqual({
      error: {
        code: "EMPLOYEE_CONFLICT",
        message: "Employee primary_phone must be unique",
        details: {
          field: "primary_phone"
        }
      }
    });
  });

  it("lists employees using the repository filters", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.employees.push({
      id: 2,
      fullName: "Sara Nabil",
      passwordHash: "plain:secret123",
      primaryPhone: "01012345670",
      whatsappPhone: "01012345671",
      email: "sara@capella.eg",
      branchId: 2,
      age: 27,
      address: "Giza",
      currentMonthlySalary: "9000",
      softDeletedAt: new Date("2026-06-22T10:00:00.000Z")
    });

    const service = createEmployeeService({
      repository
    });

    const result = await service.listEmployees({
      status: "soft_deleted"
    });

    expect(result).toEqual([
      {
        id: 2,
        fullName: "Sara Nabil",
        primaryPhone: "01012345670",
        whatsappPhone: "01012345671",
        email: "sara@capella.eg",
        branchId: 2,
        age: 27,
        address: "Giza",
        currentMonthlySalary: "9000",
        softDeletedAt: new Date("2026-06-22T10:00:00.000Z")
      }
    ]);
  });

  it("returns not found when loading a missing employee by id", async () => {
    const repository = new InMemoryEmployeeRepository();
    const service = createEmployeeService({
      repository
    });

    const result = await service.getEmployeeById(99);

    expect(result).toEqual({
      error: {
        code: "EMPLOYEE_NOT_FOUND",
        message: "Employee not found",
        details: {}
      }
    });
  });

  it("updates an employee and re-hashes the password when provided", async () => {
    const repository = new InMemoryEmployeeRepository();
    const service = createEmployeeService({
      repository
    });

    const result = await service.updateEmployee(1, {
      password: "updated123",
      currentMonthlySalary: "12000"
    }, 1);

    expect(result).toEqual({
      id: 1,
      fullName: "Mina Adel",
      primaryPhone: "01012345678",
      whatsappPhone: "01012345679",
      email: "mina@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "12000",
      softDeletedAt: null
    });
    expect(repository.employees[0]?.passwordHash).toMatch(/^scrypt\$/);
  });

  it("rejects employee updates when the target branch is not assignable", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.branchSetupStatus = "setup_pending";
    const service = createEmployeeService({
      repository
    });

    const result = await service.updateEmployee(1, {
      branchId: 2
    }, 1);

    expect(result).toEqual({
      error: {
        code: "BRANCH_NOT_ASSIGNABLE",
        message: "Employees can only be assigned to completed branches",
        details: {}
      }
    });
  });

  it("returns not found when updating a missing employee", async () => {
    const repository = new InMemoryEmployeeRepository();
    const service = createEmployeeService({
      repository
    });

    const result = await service.updateEmployee(99, {
      fullName: "No One"
    }, 1);

    expect(result).toEqual({
      error: {
        code: "EMPLOYEE_NOT_FOUND",
        message: "Employee not found",
        details: {}
      }
    });
  });

  it("maps duplicate employee fields into a conflict error during update", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.nextUpdateError = "email";
    const service = createEmployeeService({
      repository
    });

    const result = await service.updateEmployee(1, {
      email: "duplicate@capella.eg"
    }, 1);

    expect(result).toEqual({
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
    const repository = new InMemoryEmployeeRepository();
    const service = createEmployeeService({
      repository
    });

    const result = await service.deleteEmployee(1);

    expect(result).toEqual({
      success: true
    });
    expect(repository.employees[0]?.softDeletedAt).toBeInstanceOf(Date);
  });

  it("returns not found when deleting a missing employee", async () => {
    const repository = new InMemoryEmployeeRepository();
    const service = createEmployeeService({
      repository
    });

    const result = await service.deleteEmployee(99);

    expect(result).toEqual({
      error: {
        code: "EMPLOYEE_NOT_FOUND",
        message: "Employee not found",
        details: {}
      }
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
