import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  attendanceSessions,
  employees,
  monthLocks,
  permissionAbsences,
  weeklyDayOffAssignments
} from "../../../../src/db/schema";
import { createDrizzleAttendanceRepository } from "../../../../src/modules/attendance/repository";
import { setupAttendanceRepositoryTest } from "./attendance-repository.fixtures";

const databaseClient = setupAttendanceRepositoryTest();

describe("attendance repository (admin)", () => {
  it("lists admin attendance with filters, sort order, and pagination metadata", async () => {
    await databaseClient.db.insert(employees).values({
      id: 2,
      fullName: "Ahmed Gamal",
      passwordHash: "plain:test-employee-pass-123",
      primaryPhone: "01012345670",
      whatsappPhone: "01012345671",
      email: "ahmed@capella.invalid",
      branchId: 1,
      age: 30,
      address: "Giza",
      currentMonthlySalary: "12000.00"
    });
    await databaseClient.db.insert(attendanceSessions).values([
      {
        employeeId: 1,
        branchId: 1,
        status: "completed",
        checkInAtUtc: new Date("2026-06-22T06:00:00.000Z"),
        checkOutAtUtc: new Date("2026-06-22T12:00:00.000Z"),
        checkInLatitude: "30.0444200",
        checkInLongitude: "31.2357120",
        checkInIpAddress: "192.168.1.42",
        deviceId: "admin",
        branchPolicySnapshot: {},
        adminReason: "manual correction",
        createdByAdminId: 1
      },
      {
        employeeId: 2,
        branchId: 1,
        status: "open",
        checkInAtUtc: new Date("2026-06-21T06:00:00.000Z"),
        checkOutAtUtc: null,
        checkInLatitude: "30.0444200",
        checkInLongitude: "31.2357120",
        checkInIpAddress: "192.168.1.42",
        deviceId: "admin",
        branchPolicySnapshot: {},
        adminReason: "missing checkout",
        createdByAdminId: 1
      }
    ]);

    const repository = createDrizzleAttendanceRepository({
      db: databaseClient.db
    });

    const rows = await repository.listAdminAttendance({
      page: 1,
      pageSize: 10,
      employeeName: "ahmed",
      sortBy: "employee_name",
      sortDirection: "asc"
    });

    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]).toMatchObject({
      employeeId: 2,
      employeeName: "Ahmed Gamal",
      status: "open",
      adminReason: "missing checkout"
    });
    expect(rows.pagination).toEqual({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1
    });
  });

  it("creates, updates, deletes, and checks admin attendance conflicts", async () => {
    await databaseClient.db.insert(weeklyDayOffAssignments).values({
      employeeId: 1,
      weekStartDate: new Date("2026-06-20T00:00:00.000Z"),
      dayOffDate: new Date("2026-06-22T00:00:00.000Z"),
      assignedByAdminId: 1
    });
    await databaseClient.db.insert(permissionAbsences).values({
      employeeId: 1,
      absenceDate: new Date("2026-06-23T00:00:00.000Z"),
      createdByAdminId: 1
    });
    await databaseClient.db.insert(monthLocks).values({
      monthKey: "2026-06",
      lockedAt: new Date("2026-06-30T21:00:00.000Z"),
      lockedByAdminId: 1
    });

    const repository = createDrizzleAttendanceRepository({
      db: databaseClient.db
    });

    const created = await repository.createAdminAttendance({
      employeeId: 1,
      branchId: 1,
      checkInAtUtc: new Date("2026-07-01T06:00:00.000Z"),
      checkOutAtUtc: new Date("2026-07-01T12:00:00.000Z"),
      reason: "manual correction",
      adminId: 1
    });

    expect(created).toMatchObject({
      employeeId: 1,
      status: "completed",
      adminReason: "manual correction",
      createdByAdminId: 1
    });

    const updated = await repository.updateAdminAttendance(created.id, {
      branchId: 1,
      checkInAtUtc: new Date("2026-07-01T07:00:00.000Z"),
      checkOutAtUtc: null,
      reason: "reopened",
      adminId: 1
    });

    expect(updated).toMatchObject({
      id: created.id,
      status: "open",
      adminReason: "reopened",
      updatedByAdminId: 1
    });

    await expect(repository.hasWeeklyDayOff(1, "2026-06-22")).resolves.toBe(true);
    await expect(repository.hasPermissionAbsence(1, "2026-06-23")).resolves.toBe(true);
    await expect(repository.isMonthLocked("2026-06")).resolves.toBe(true);

    await expect(repository.deleteAdminAttendance(created.id)).resolves.toBe(true);

    const persisted = await databaseClient.db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, created.id));
    expect(persisted).toHaveLength(0);
  });
});
