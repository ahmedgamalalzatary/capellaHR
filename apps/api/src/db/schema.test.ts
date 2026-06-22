import { describe, expect, it } from "vitest";
import * as schema from "./schema";

describe("database schema", () => {
  it("exports the core identity tables", () => {
    expect(schema).toMatchObject({
      admins: expect.anything(),
      employees: expect.anything(),
      branches: expect.anything()
    });
  });

  it("exports the employee support tables", () => {
    expect(schema).toMatchObject({
      salaryHistory: expect.anything(),
      employeeFiles: expect.anything(),
      employeeBranchAssignments: expect.anything(),
      employeeDeviceRegistrations: expect.anything()
    });
  });

  it("exports the branch setup and device tables", () => {
    expect(schema).toMatchObject({
      branchSetupLinks: expect.anything(),
      branchDeviceRegistrations: expect.anything()
    });
  });

  it("exports the attendance and operations tables", () => {
    expect(schema).toMatchObject({
      attendanceSessions: expect.anything(),
      attendanceBlockedAttempts: expect.anything(),
      weeklyDayOffAssignments: expect.anything(),
      permissionAbsences: expect.anything(),
      monthLocks: expect.anything(),
      auditLogs: expect.anything()
    });
  });
});
