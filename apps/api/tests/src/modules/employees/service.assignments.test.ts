import { describe, expect, it } from "vitest";
import { createEmployeeService } from "../../../../src/modules/employees/service";
import { InMemoryAuditLogService } from "../audit-logs/audit-log-test.fixtures";
import { InMemoryEmployeeFileStorage, InMemoryEmployeeRepository } from "./employee-service.fixtures";

describe("employee service (branch assignments)", () => {
  it("creates an immediate branch assignment when no open session exists", async () => {
    const repository = new InMemoryEmployeeRepository();
    const auditLogService = new InMemoryAuditLogService();
    const service = createEmployeeService({
      repository,
      fileStorage: new InMemoryEmployeeFileStorage(),
      auditLogService
    });

    const result = await service.assignEmployeeBranch(1, {
      branchId: 2,
      effectiveFrom: "2026-06-22T10:00:00.000Z"
    }, 1, new Date("2026-06-22T10:00:00.000Z"));

    expect(result).toMatchObject({
      employeeId: 1,
      branchId: 2,
      effectiveFrom: "2026-06-22T10:00:00.000Z"
    });
    expect(repository.employees[0]?.branchId).toBe(2);
    expect(auditLogService.logs[0]).toMatchObject({
      actionType: "create",
      entityType: "employee_branch_assignment",
      entityId: "2"
    });
  });

  it("rejects past-effective branch assignments", async () => {
    const repository = new InMemoryEmployeeRepository();
    const service = createEmployeeService({
      repository,
      fileStorage: new InMemoryEmployeeFileStorage()
    });

    const result = await service.assignEmployeeBranch(1, {
      branchId: 2,
      effectiveFrom: "2026-06-22T09:59:59.000Z"
    }, 1, new Date("2026-06-22T10:00:00.000Z"));

    expect(result).toEqual({
      error: {
        code: "EMPLOYEE_BRANCH_ASSIGNMENT_PAST_DATE",
        message: "Branch assignments can only be effective now or in the future",
        details: {}
      }
    });
  });

  it("schedules a branch assignment without changing the current branch during an open session", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.openSessionEmployeeIds.add(1);
    const service = createEmployeeService({
      repository,
      fileStorage: new InMemoryEmployeeFileStorage()
    });

    const result = await service.assignEmployeeBranch(1, {
      branchId: 2,
      effectiveFrom: "2026-06-22T10:00:00.000Z"
    }, 1, new Date("2026-06-22T10:00:00.000Z"));

    expect(result).toMatchObject({
      employeeId: 1,
      branchId: 2
    });
    expect(repository.employees[0]?.branchId).toBe(1);
  });
});
