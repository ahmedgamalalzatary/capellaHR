import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../../db/client";
import {
  admins,
  attendanceSessions,
  branches,
  employees,
  monthLocks
} from "../../db/schema";
import { resetTestDatabase } from "../../test/reset-database";
import { createDrizzlePermissionAbsenceRepository } from "./repository";

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

afterAll(async () => {
  await databaseClient.close();
});

describe("permission absence repository", () => {
  it("creates and lists permission absences", async () => {
    const repository = createDrizzlePermissionAbsenceRepository({
      db: databaseClient.db
    });

    const created = await repository.createAbsence({
      employeeId: 1,
      absenceDate: "2026-06-29",
      createdByAdminId: 1
    });

    expect(created).toMatchObject({
      employeeId: 1,
      absenceDate: "2026-06-29",
      permissionType: "generic"
    });

    const rows = await repository.listAbsences(1, "2026-06");
    expect(rows).toHaveLength(1);
  });

  it("updates absences and detects attendance conflicts", async () => {
    const repository = createDrizzlePermissionAbsenceRepository({
      db: databaseClient.db
    });
    const created = await repository.createAbsence({
      employeeId: 1,
      absenceDate: "2026-06-29",
      createdByAdminId: 1
    });
    await databaseClient.db.insert(attendanceSessions).values({
      employeeId: 1,
      branchId: 1,
      status: "completed",
      checkInAtUtc: new Date("2026-06-29T06:00:00.000Z"),
      checkOutAtUtc: new Date("2026-06-29T12:00:00.000Z"),
      checkInLatitude: "30.0444200",
      checkInLongitude: "31.2357120",
      checkInIpAddress: "192.168.1.42",
      deviceId: "device-1",
      branchPolicySnapshot: { allowedIpCidr: "192.168.1.0/24" }
    });

    const updated = await repository.updateAbsence(created.id, {
      absenceDate: "2026-06-30",
      updatedByAdminId: 1
    });

    expect(updated?.absenceDate).toBe("2026-06-30");
    await expect(repository.hasAttendanceOnDate(1, "2026-06-29")).resolves.toBe(true);
  });

  it("detects locked months", async () => {
    const repository = createDrizzlePermissionAbsenceRepository({
      db: databaseClient.db
    });
    await databaseClient.db.insert(monthLocks).values({
      monthKey: "2026-06",
      lockedAt: new Date("2026-06-30T23:00:00.000Z"),
      lockedByAdminId: 1
    });

    await expect(repository.isMonthLocked("2026-06")).resolves.toBe(true);
  });
});
