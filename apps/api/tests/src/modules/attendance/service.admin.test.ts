import { describe, expect, it } from "vitest";
import { createAttendanceService } from "../../../../src/modules/attendance/service";
import { createBaseRepository, InMemoryAuditLogService } from "./attendance-service.fixtures";

describe("attendance service (admin)", () => {
  it("lists admin attendance with employee-name filtering and employee-name sorting", async () => {
    const repository = createBaseRepository();
    repository.employees.set(2, {
      id: 2,
      fullName: "Mina Adel",
      branchId: 1,
      softDeletedAt: null
    });
    repository.sessions.push({
      id: 1,
      employeeId: 2,
      branchId: 1,
      status: "completed",
      checkInAtUtc: new Date("2026-06-20T06:00:00.000Z"),
      checkOutAtUtc: new Date("2026-06-20T12:00:00.000Z"),
      checkInLatitude: 0,
      checkInLongitude: 0,
      checkInIpAddress: "",
      deviceId: "admin",
      branchPolicySnapshot: {},
      adminReason: "manual correction",
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    repository.sessions.push({
      id: 2,
      employeeId: 1,
      branchId: 1,
      status: "completed",
      checkInAtUtc: new Date("2026-06-21T06:00:00.000Z"),
      checkOutAtUtc: new Date("2026-06-21T12:00:00.000Z"),
      checkInLatitude: 0,
      checkInLongitude: 0,
      checkInIpAddress: "",
      deviceId: "admin",
      branchPolicySnapshot: {},
      adminReason: "manual correction",
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const service = createAttendanceService({ repository });

    const result = await service.listAdminAttendance({
      employeeName: "mina",
      sortBy: "employee_name",
      sortDirection: "asc"
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.employeeName).toBe("Mina Adel");
  });

  it("creates admin attendance without employee device or gps validation", async () => {
    const repository = createBaseRepository();
    const auditLogService = new InMemoryAuditLogService();
    const service = createAttendanceService({ repository, auditLogService });

    const result = await service.createAdminAttendance({
      employeeId: 1,
      branchId: 1,
      checkInAt: "2026-06-22T08:00:00.000Z",
      checkOutAt: "2026-06-22T16:00:00.000Z",
      reason: "manual correction"
    }, 1);

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(result.status).toBe("completed");
    expect(result.adminReason).toBe("manual correction");
    expect(repository.sessions).toHaveLength(1);
    expect(auditLogService.logs).toHaveLength(1);
    expect(auditLogService.logs[0]).toMatchObject({
      actionType: "create",
      entityType: "attendance",
      reason: "manual correction"
    });
  });

  it("blocks admin attendance creation when the date conflicts with a permission absence", async () => {
    const repository = createBaseRepository();
    repository.permissionAbsenceDates.add("1:2026-06-22");
    const service = createAttendanceService({ repository });

    const result = await service.createAdminAttendance({
      employeeId: 1,
      branchId: 1,
      checkInAt: "2026-06-22T08:00:00.000Z",
      checkOutAt: "2026-06-22T16:00:00.000Z",
      reason: "manual correction"
    }, 1);

    expect(result).toEqual({
      error: {
        code: "ATTENDANCE_DATE_CONFLICT",
        message: "Attendance conflicts with existing day classification",
        details: {
          conflictType: "permission_absence"
        }
      }
    });
  });

  it("updates admin attendance and preserves same-Cairo-day enforcement", async () => {
    const repository = createBaseRepository();
    repository.sessions.push({
      id: 1,
      employeeId: 1,
      branchId: 1,
      status: "completed",
      checkInAtUtc: new Date("2026-06-22T08:00:00.000Z"),
      checkOutAtUtc: new Date("2026-06-22T12:00:00.000Z"),
      checkInLatitude: 0,
      checkInLongitude: 0,
      checkInIpAddress: "",
      deviceId: "admin",
      branchPolicySnapshot: {},
      adminReason: "before",
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const service = createAttendanceService({ repository });

    const result = await service.updateAdminAttendance(1, {
      branchId: 1,
      checkInAt: "2026-06-22T09:00:00.000Z",
      checkOutAt: "2026-06-23T00:30:00.000Z",
      reason: "manual correction"
    }, 1);

    expect(result).toEqual({
      error: {
        code: "OVERNIGHT_ATTENDANCE_NOT_ALLOWED",
        message: "Attendance check-out must happen on the same Cairo date",
        details: {}
      }
    });
  });

  it("deletes admin attendance records with month-lock enforcement", async () => {
    const repository = createBaseRepository();
    repository.lockedMonths.add("2026-06");
    repository.sessions.push({
      id: 1,
      employeeId: 1,
      branchId: 1,
      status: "completed",
      checkInAtUtc: new Date("2026-06-22T08:00:00.000Z"),
      checkOutAtUtc: new Date("2026-06-22T12:00:00.000Z"),
      checkInLatitude: 0,
      checkInLongitude: 0,
      checkInIpAddress: "",
      deviceId: "admin",
      branchPolicySnapshot: {},
      adminReason: "manual correction",
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const service = createAttendanceService({ repository });

    const result = await service.deleteAdminAttendance(1, "remove duplicate", 1);

    expect(result).toEqual({
      error: {
        code: "MONTH_LOCKED",
        message: "The month is locked",
        details: {}
      }
    });
  });
});
