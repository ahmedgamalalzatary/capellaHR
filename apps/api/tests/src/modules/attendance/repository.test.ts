import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseClient, resetDatabaseClient } from "../../../../src/db/client";
import {
  admins,
  attendanceBlockedAttempts,
  attendanceSessions,
  branches,
  employeeDeviceRegistrations,
  employees,
  monthLocks,
  permissionAbsences,
  weeklyDayOffAssignments
} from "../../../../src/db/schema";
import { resetTestDatabase } from "../../../../src/test/reset-database";
import { createDrizzleAttendanceRepository } from "../../../../src/modules/attendance/repository";

loadEnv({
  path: resolve(process.cwd(), "../../.env.test"),
  override: true
});

const databaseClient = createDatabaseClient({
  databaseUrl: process.env.DATABASE_URL ?? ""
});

beforeAll(async () => {
  await databaseClient.db.execute("SELECT 1");
});

describe("attendance repository", () => {
  beforeEach(async () => {
    await resetTestDatabase(databaseClient.db);

    await databaseClient.db.insert(admins).values({
      id: 1,
      name: "Capella Admin",
      email: "admin@capella.eg",
      passwordHash: "plain:admin1234"
    });

    await databaseClient.db.insert(branches).values({
      id: 1,
      name: "Nasr City",
      address: "Cairo",
      gpsLatitude: "30.0444200",
      gpsLongitude: "31.2357120",
      gpsRadiusMeters: 200,
      allowedIpCidr: "192.168.1.0/24",
      registeredDeviceToken: "branch-device-1",
      setupStatus: "completed"
    });

    await databaseClient.db.insert(employees).values({
      id: 1,
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01012345678",
      whatsappPhone: "01012345679",
      email: "mina@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00"
    });
  });

  it("loads employee, branch, and active employee device data", async () => {
    await databaseClient.db.insert(employeeDeviceRegistrations).values({
      employeeId: 1,
      deviceToken: "device-1",
      deviceLabel: "Phone",
      browserFingerprint: "personal-device-1",
      status: "active",
      registeredAt: new Date("2026-06-22T06:00:00.000Z")
    });

    const repository = createDrizzleAttendanceRepository({
      db: databaseClient.db
    });

    await expect(repository.findEmployeeById(1)).resolves.toEqual({
      id: 1,
      fullName: "Mina Adel",
      branchId: 1,
      softDeletedAt: null
    });
    await expect(repository.findBranchById(1)).resolves.toEqual({
      id: 1,
      setupStatus: "completed",
      gpsLatitude: "30.0444200",
      gpsLongitude: "31.2357120",
      gpsRadiusMeters: 200,
      allowedIpCidr: "192.168.1.0/24",
      registeredDeviceToken: "branch-device-1"
    });
    await expect(repository.findActiveEmployeeDeviceFingerprint(1)).resolves.toBe("personal-device-1");
  });

  it("creates and completes attendance sessions", async () => {
    const repository = createDrizzleAttendanceRepository({
      db: databaseClient.db
    });

    const created = await repository.createSession({
      employeeId: 1,
      branchId: 1,
      checkInAtUtc: new Date("2026-06-22T06:00:00.000Z"),
      checkInLatitude: 30.04442,
      checkInLongitude: 31.235712,
      checkInIpAddress: "192.168.1.42",
      deviceId: "personal-device-1",
      branchPolicySnapshot: {
        allowedIpCidr: "192.168.1.0/24"
      }
    });

    expect(created.status).toBe("open");

    const completed = await repository.completeSession(created.id, new Date("2026-06-22T12:00:00.000Z"));

    expect(completed?.status).toBe("completed");
    expect(completed?.checkOutAtUtc).toEqual(new Date("2026-06-22T12:00:00.000Z"));

    const persisted = await databaseClient.db.select().from(attendanceSessions).where(eq(attendanceSessions.id, created.id));
    expect(persisted[0]?.status).toBe("completed");
  });

  it("stores blocked attempts with validation evidence", async () => {
    const repository = createDrizzleAttendanceRepository({
      db: databaseClient.db
    });

    const blockedAttempt = await repository.createBlockedAttempt({
      employeeId: 1,
      branchId: 1,
      attemptedAction: "check_in",
      failureReasons: ["device_not_allowed", "ip_not_allowed"],
      latitude: 30.04442,
      longitude: 31.235712,
      ipAddress: "10.0.0.10",
      deviceId: "unknown-device",
      branchPolicySnapshot: {
        allowedIpCidr: "192.168.1.0/24"
      },
      occurredAtUtc: new Date("2026-06-22T06:00:00.000Z")
    });

    expect(blockedAttempt.failureReasons).toEqual(["device_not_allowed", "ip_not_allowed"]);

    const persisted = await databaseClient.db.select().from(attendanceBlockedAttempts).where(
      eq(attendanceBlockedAttempts.id, blockedAttempt.id)
    );
    expect(persisted[0]?.attemptedAction).toBe("check_in");
  });

  it("lists admin attendance with filters and sort order", async () => {
    await databaseClient.db.insert(employees).values({
      id: 2,
      fullName: "Ahmed Gamal",
      passwordHash: "plain:secret123",
      primaryPhone: "01012345670",
      whatsappPhone: "01012345671",
      email: "ahmed@capella.eg",
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
      employeeName: "ahmed",
      sortBy: "employee_name",
      sortDirection: "asc"
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      employeeId: 2,
      employeeName: "Ahmed Gamal",
      status: "open",
      adminReason: "missing checkout"
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

afterAll(async () => {
  await databaseClient.close();
  await resetDatabaseClient();
});
