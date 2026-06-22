import { describe, expect, it } from "vitest";
import { createEmployeeService } from "../../../../src/modules/employees/service";
import { InMemoryAuditLogService } from "../audit-logs/audit-log-test.fixtures";
import {
  InMemoryEmployeeFileStorage,
  InMemoryEmployeeRepository,
  createInput,
  createRequiredFiles,
  createUploadedFile
} from "./employee-service.fixtures";

describe("employee service (crud)", () => {
  it("rejects employee creation when the required files are missing", async () => {
    const repository = new InMemoryEmployeeRepository();
    const storage = new InMemoryEmployeeFileStorage();
    const service = createEmployeeService({
      repository,
      fileStorage: storage
    });

    const result = await service.createEmployee(createInput(), [
      createUploadedFile("personal_photo")
    ], 1);

    expect(result).toEqual({
      error: {
        code: "MISSING_EMPLOYEE_FILES",
        message: "Employee files are required",
        details: {
          missingFileTypes: ["id_front", "id_back"]
        }
      }
    });
  });

  it("rejects employee creation for setup pending branches", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.branchSetupStatus = "setup_pending";
    const storage = new InMemoryEmployeeFileStorage();

    const service = createEmployeeService({
      repository,
      fileStorage: storage
    });

    const result = await service.createEmployee(createInput(), createRequiredFiles(), 1);

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
    const storage = new InMemoryEmployeeFileStorage();
    const auditLogService = new InMemoryAuditLogService();
    const service = createEmployeeService({
      repository,
      fileStorage: storage,
      auditLogService
    });

    const result = await service.createEmployee(createInput(), createRequiredFiles(), 1);

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
    expect(repository.employeeFiles).toHaveLength(3);
    expect(storage.savedFiles).toHaveLength(3);
    expect(auditLogService.logs[0]).toMatchObject({
      actionType: "create",
      entityType: "employee",
      entityId: "1"
    });
  });

  it("maps duplicate employee fields into a conflict error during creation", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.nextCreateError = "primary_phone";
    const storage = new InMemoryEmployeeFileStorage();
    const service = createEmployeeService({
      repository,
      fileStorage: storage
    });

    const result = await service.createEmployee(createInput(), createRequiredFiles(), 1);

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
      repository,
      fileStorage: new InMemoryEmployeeFileStorage()
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
      repository,
      fileStorage: new InMemoryEmployeeFileStorage()
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
    const auditLogService = new InMemoryAuditLogService();
    const service = createEmployeeService({
      repository,
      fileStorage: new InMemoryEmployeeFileStorage(),
      auditLogService
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
    expect(auditLogService.logs[0]).toMatchObject({
      actionType: "update",
      entityType: "employee",
      entityId: "1"
    });
  });

  it("rejects employee updates when the target branch is not assignable", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.branchSetupStatus = "setup_pending";
    const service = createEmployeeService({
      repository,
      fileStorage: new InMemoryEmployeeFileStorage()
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
      repository,
      fileStorage: new InMemoryEmployeeFileStorage()
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
      repository,
      fileStorage: new InMemoryEmployeeFileStorage()
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
    const auditLogService = new InMemoryAuditLogService();
    const service = createEmployeeService({
      repository,
      fileStorage: new InMemoryEmployeeFileStorage(),
      auditLogService
    });

    const result = await service.deleteEmployee(1);

    expect(result).toEqual({
      success: true
    });
    expect(repository.employees[0]?.softDeletedAt).toBeInstanceOf(Date);
    expect(auditLogService.logs[0]).toMatchObject({
      actionType: "soft_delete",
      entityType: "employee",
      entityId: "1"
    });
  });

  it("returns not found when deleting a missing employee", async () => {
    const repository = new InMemoryEmployeeRepository();
    const service = createEmployeeService({
      repository,
      fileStorage: new InMemoryEmployeeFileStorage()
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
