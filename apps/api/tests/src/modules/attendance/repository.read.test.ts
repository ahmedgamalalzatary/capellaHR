import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  attendanceBlockedAttempts,
  attendanceSessions,
  employeeDeviceRegistrations
} from "../../../../src/db/schema";
import { createDrizzleAttendanceRepository } from "../../../../src/modules/attendance/repository";
import { setupAttendanceRepositoryTest } from "./attendance-repository.fixtures";

const databaseClient = setupAttendanceRepositoryTest();

describe("attendance repository (employee data)", () => {
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
});
