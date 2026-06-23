import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../../../../src/db/client";
import {
  admins,
  attendanceSessions,
  branches,
  employeeBranchAssignments,
  employees,
  permissionAbsences,
  weeklyDayOffAssignments
} from "../../../../src/db/schema";
import { createDrizzleReportsRepository } from "../../../../src/modules/reports/repository";
import { resetTestDatabase } from "../../../../src/test/reset-database";

loadEnv({
  path: resolve(process.cwd(), "../../.env.test"),
  override: true
});

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run this test (set it in .env.test)");
}

const databaseClient = createDatabaseClient({
  databaseUrl
});

beforeAll(async () => {
  await databaseClient.db.execute("SELECT 1");
});

beforeEach(async () => {
  await resetTestDatabase(databaseClient.db);
  await databaseClient.db.insert(admins).values({
    id: 1,
    name: "Capella Admin",
    email: "admin.test@capella.invalid",
    passwordHash: "plain:test-admin-pass-123"
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
  await databaseClient.db.insert(employees).values({
    id: 1,
    fullName: "Mina Adel",
    passwordHash: "plain:test-employee-pass-123",
    primaryPhone: "01012345678",
    whatsappPhone: "01012345679",
    email: "employee.test@capella.invalid",
    branchId: 2,
    age: 28,
    address: "Cairo",
    currentMonthlySalary: "10000.00"
  });
  await databaseClient.db.insert(employeeBranchAssignments).values([
    {
      employeeId: 1,
      branchId: 1,
      effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-06-16T00:00:00.000Z"),
      assignedByAdminId: 1
    },
    {
      employeeId: 1,
      branchId: 2,
      effectiveFrom: new Date("2026-06-16T00:00:00.000Z"),
      assignedByAdminId: 1
    }
  ]);
});

afterAll(async () => {
  await databaseClient.close();
});

describe("reports repository", () => {
  it("loads historical branch assignments and classified dates for a month", async () => {
    const repository = createDrizzleReportsRepository({
      db: databaseClient.db
    });

    await databaseClient.db.insert(attendanceSessions).values([
      {
        employeeId: 1,
        branchId: 1,
        status: "completed",
        checkInAtUtc: new Date("2026-06-02T06:00:00.000Z"),
        checkOutAtUtc: new Date("2026-06-02T12:00:00.000Z"),
        checkInLatitude: "30.0444200",
        checkInLongitude: "31.2357120",
        checkInIpAddress: "192.168.1.42",
        deviceId: "device-1",
        branchPolicySnapshot: { allowedIpCidr: "192.168.1.0/24" }
      },
      {
        employeeId: 1,
        branchId: 2,
        status: "completed",
        checkInAtUtc: new Date("2026-06-18T06:00:00.000Z"),
        checkOutAtUtc: new Date("2026-06-18T12:00:00.000Z"),
        checkInLatitude: "29.9602000",
        checkInLongitude: "31.2569000",
        checkInIpAddress: "192.168.2.42",
        deviceId: "device-1",
        branchPolicySnapshot: { allowedIpCidr: "192.168.2.0/24" }
      }
    ]);
    await databaseClient.db.insert(weeklyDayOffAssignments).values([
      {
        employeeId: 1,
        weekStartDate: new Date("2026-05-30T00:00:00.000Z"),
        dayOffDate: new Date("2026-06-06T00:00:00.000Z"),
        assignedByAdminId: 1
      },
      {
        employeeId: 1,
        weekStartDate: new Date("2026-06-13T00:00:00.000Z"),
        dayOffDate: new Date("2026-06-20T00:00:00.000Z"),
        assignedByAdminId: 1
      }
    ]);
    await databaseClient.db.insert(permissionAbsences).values([
      {
        employeeId: 1,
        absenceDate: new Date("2026-06-10T00:00:00.000Z"),
        createdByAdminId: 1
      },
      {
        employeeId: 1,
        absenceDate: new Date("2026-06-25T00:00:00.000Z"),
        createdByAdminId: 1
      }
    ]);

    const employeesList = await repository.listEmployees({});
    const assignments = await repository.listBranchAssignments(1, "2026-06");
    const attendanceDates = await repository.listCompletedAttendanceDates(1, "2026-06");
    const weeklyDayOffDates = await repository.listWeeklyDayOffDates(1, "2026-06");
    const permissionAbsenceDates = await repository.listPermissionAbsenceDates(1, "2026-06");

    expect(employeesList).toEqual([
      {
        id: 1,
        fullName: "Mina Adel",
        branchId: 2,
        branchName: "Maadi"
      }
    ]);
    expect(assignments).toEqual([
      {
        branchId: 1,
        branchName: "Nasr City",
        effectiveFrom: "2026-06-01T00:00:00.000Z",
        effectiveTo: "2026-06-16T00:00:00.000Z"
      },
      {
        branchId: 2,
        branchName: "Maadi",
        effectiveFrom: "2026-06-16T00:00:00.000Z",
        effectiveTo: null
      }
    ]);
    expect(attendanceDates).toEqual([
      {
        date: "2026-06-02",
        branchId: 1,
        branchName: "Nasr City"
      },
      {
        date: "2026-06-18",
        branchId: 2,
        branchName: "Maadi"
      }
    ]);
    expect(weeklyDayOffDates).toEqual(["2026-06-06", "2026-06-20"]);
    expect(permissionAbsenceDates).toEqual(["2026-06-10", "2026-06-25"]);
  });
});
