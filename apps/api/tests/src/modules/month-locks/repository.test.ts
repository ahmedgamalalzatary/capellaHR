import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../../../../src/db/client";
import {
  admins,
  attendanceSessions,
  branches,
  employees,
  monthLocks
} from "../../../../src/db/schema";
import { createDrizzleMonthLockRepository } from "../../../../src/modules/month-locks/repository";
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
    passwordHash: "plain:test-employee-pass-123",
    primaryPhone: "01012345678",
    whatsappPhone: "01012345679",
    email: "employee.test@capella.invalid",
    branchId: 1,
    age: 28,
    address: "Cairo",
    currentMonthlySalary: "10000.00"
  });
});

afterAll(async () => {
  await databaseClient.close();
});

describe("month lock repository", () => {
  it("creates and lists month locks", async () => {
    const repository = createDrizzleMonthLockRepository({
      db: databaseClient.db
    });

    const created = await repository.createMonthLock({
      monthKey: "2026-06",
      lockedByAdminId: 1,
      notes: "Closed"
    });

    expect(created).toMatchObject({
      monthKey: "2026-06",
      lockedByAdminId: 1,
      notes: "Closed"
    });

    const rows = await repository.listMonthLocks({ page: 1, pageSize: 20 });
    expect(rows.items).toHaveLength(1);
    expect(rows.pagination).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1
    });
  });

  it("paginates month locks", async () => {
    const repository = createDrizzleMonthLockRepository({
      db: databaseClient.db
    });
    await databaseClient.db.insert(monthLocks).values([
      {
        monthKey: "2026-06",
        lockedAt: new Date("2026-07-01T00:00:00.000Z"),
        lockedByAdminId: 1
      },
      {
        monthKey: "2026-05",
        lockedAt: new Date("2026-06-01T00:00:00.000Z"),
        lockedByAdminId: 1
      }
    ]);

    const rows = await repository.listMonthLocks({ page: 2, pageSize: 1 });

    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]?.monthKey).toBe("2026-05");
    expect(rows.pagination).toEqual({
      page: 2,
      pageSize: 1,
      total: 2,
      totalPages: 2
    });
  });

  it("finds existing month locks by month key", async () => {
    const repository = createDrizzleMonthLockRepository({
      db: databaseClient.db
    });
    await databaseClient.db.insert(monthLocks).values({
      monthKey: "2026-06",
      lockedAt: new Date("2026-07-01T00:00:00.000Z"),
      lockedByAdminId: 1,
      notes: "Closed"
    });

    await expect(repository.findMonthLockByMonthKey("2026-06")).resolves.toMatchObject({
      monthKey: "2026-06"
    });
  });

  it("detects open sessions in a month", async () => {
    const repository = createDrizzleMonthLockRepository({
      db: databaseClient.db
    });
    await databaseClient.db.insert(attendanceSessions).values({
      employeeId: 1,
      branchId: 1,
      status: "open",
      checkInAtUtc: new Date("2026-06-29T06:00:00.000Z"),
      checkOutAtUtc: null,
      checkInLatitude: "30.0444200",
      checkInLongitude: "31.2357120",
      checkInIpAddress: "192.168.1.42",
      deviceId: "device-1",
      branchPolicySnapshot: { allowedIpCidr: "192.168.1.0/24" }
    });

    await expect(repository.hasOpenSessions("2026-06")).resolves.toBe(true);
  });

  it("rejects malformed month keys", async () => {
    const repository = createDrizzleMonthLockRepository({
      db: databaseClient.db
    });

    await expect(repository.hasOpenSessions("2026-6")).rejects.toThrow(
      "Invalid month key format"
    );
  });
});
