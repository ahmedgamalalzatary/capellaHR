import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../../../../src/db/client";
import {
  admins,
  attendanceSessions,
  branches,
  employees,
  permissionAbsences,
  weeklyDayOffAssignments
} from "../../../../src/db/schema";
import { resetTestDatabase } from "../../../../src/test/reset-database";
import { createDrizzleReportsRepository } from "../../../../src/modules/reports/repository";

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
  await databaseClient.db.insert(branches).values([
    {
      id: 1,
      name: "Nasr City",
      address: "Cairo",
      gpsLatitude: "30.0444200",
      gpsLongitude: "31.2357120",
      gpsRadiusMeters: 200,
      allowedIpCidr: "192.168.1.0/24",
      setupStatus: "completed"
    },
    {
      id: 2,
      name: "Maadi",
      address: "Cairo",
      gpsLatitude: "29.9602000",
      gpsLongitude: "31.2569000",
      gpsRadiusMeters: 200,
      allowedIpCidr: "192.168.2.0/24",
      setupStatus: "completed"
    }
  ]);
  await databaseClient.db.insert(employees).values([
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
      currentMonthlySalary: "10000.00"
    },
    {
      id: 2,
      fullName: "Sara Nabil",
      passwordHash: "plain:secret123",
      primaryPhone: "01112345678",
      whatsappPhone: "01112345679",
      email: "sara@capella.eg",
      branchId: 2,
      age: 27,
      address: "Cairo",
      currentMonthlySalary: "11000.00"
    }
  ]);
});

afterAll(async () => {
  await databaseClient.close();
});

describe("reports repository", () => {
  it("lists employees and classification dates for a month", async () => {
    const repository = createDrizzleReportsRepository({
      db: databaseClient.db
    });

    await databaseClient.db.insert(attendanceSessions).values([
      {
        employeeId: 1,
        branchId: 1,
        status: "completed",
        checkInAtUtc: new Date("2026-06-01T06:00:00.000Z"),
        checkOutAtUtc: new Date("2026-06-01T12:00:00.000Z"),
        checkInLatitude: "30.0444200",
        checkInLongitude: "31.2357120",
        checkInIpAddress: "192.168.1.42",
        deviceId: "device-1",
        branchPolicySnapshot: { allowedIpCidr: "192.168.1.0/24" }
      },
      {
        employeeId: 1,
        branchId: 1,
        status: "completed",
        checkInAtUtc: new Date("2026-06-01T14:00:00.000Z"),
        checkOutAtUtc: new Date("2026-06-01T18:00:00.000Z"),
        checkInLatitude: "30.0444200",
        checkInLongitude: "31.2357120",
        checkInIpAddress: "192.168.1.42",
        deviceId: "device-1",
        branchPolicySnapshot: { allowedIpCidr: "192.168.1.0/24" }
      }
    ]);
    await databaseClient.db.insert(weeklyDayOffAssignments).values({
      employeeId: 1,
      weekStartDate: new Date("2026-05-30T00:00:00.000Z"),
      dayOffDate: new Date("2026-06-05T00:00:00.000Z"),
      assignedByAdminId: 1
    });
    await databaseClient.db.insert(permissionAbsences).values({
      employeeId: 1,
      absenceDate: new Date("2026-06-06T00:00:00.000Z"),
      createdByAdminId: 1
    });

    const employeesList = await repository.listEmployees({ branchId: 1 });
    const attendanceDates = await repository.listCompletedAttendanceDates(1, "2026-06");
    const weeklyDayOffDates = await repository.listWeeklyDayOffDates(1, "2026-06");
    const permissionAbsenceDates = await repository.listPermissionAbsenceDates(1, "2026-06");

    expect(employeesList).toEqual([
      {
        id: 1,
        fullName: "Mina Adel",
        branchId: 1,
        branchName: "Nasr City"
      }
    ]);
    expect(attendanceDates).toEqual(["2026-06-01", "2026-06-01"]);
    expect(weeklyDayOffDates).toEqual(["2026-06-05"]);
    expect(permissionAbsenceDates).toEqual(["2026-06-06"]);
  });
});
