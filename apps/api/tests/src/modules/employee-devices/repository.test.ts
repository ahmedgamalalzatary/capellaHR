import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createDatabaseClient } from "../../../../src/db/client";
import { admins, branches, employeeDeviceRegistrations, employees } from "../../../../src/db/schema";
import { resetTestDatabase } from "../../../../src/test/reset-database";
import { createDrizzleEmployeeDeviceRepository, type EmployeeDeviceRegistrationRecord } from "../../../../src/modules/employee-devices/repository";

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
    name: "Capella Admin Test",
    email: "employee-devices-admin-test@capella.eg",
    passwordHash: "plain:admin1234"
  });
  await databaseClient.db.insert(branches).values({
    id: 1,
    name: "Nasr City",
    address: "Cairo",
    gpsLatitude: "30.0500000",
    gpsLongitude: "31.2500000",
    gpsRadiusMeters: 100,
    allowedIpCidr: "192.168.1.0/24",
    setupStatus: "completed"
  });
  await databaseClient.db.insert(employees).values({
    id: 1,
    fullName: "Mina Adel",
    passwordHash: "plain:secret123",
    primaryPhone: "01070000001",
    whatsappPhone: "01070000002",
    email: "mina-employee-devices@capella.eg",
    branchId: 1,
    age: 28,
    address: "Cairo",
    currentMonthlySalary: "10000.00"
  });
});

afterAll(async () => {
  await databaseClient.close();
});

describe("drizzle employee device repository", () => {
  it("creates and loads a pending device registration", async () => {
    const repository = createDrizzleEmployeeDeviceRepository({
      db: databaseClient.db
    });

    const registration = await repository.createPendingRegistration({
      employeeId: 1,
      deviceToken: "token-1",
      deviceLabel: "Samsung A55",
      expiresAt: new Date("2026-06-22T11:00:00.000Z")
    });

    expect(registration).toEqual({
      id: expect.any(Number),
      employeeId: 1,
      deviceToken: "token-1",
      deviceLabel: "Samsung A55",
      browserFingerprint: null,
      status: "pending",
      registeredAt: null,
      revokedAt: null,
      expiresAt: new Date("2026-06-22T11:00:00.000Z")
    });

    const pending = await repository.findPendingRegistration(1);
    expect(pending).toEqual(registration);
  });

  it("activates a pending registration and replaces older active registrations", async () => {
    const repository = createDrizzleEmployeeDeviceRepository({
      db: databaseClient.db
    });

    await databaseClient.db.insert(employeeDeviceRegistrations).values({
      employeeId: 1,
      deviceToken: "old-active",
      deviceLabel: "Old phone",
      browserFingerprint: "old-fingerprint",
      status: "active",
      registeredAt: new Date("2026-06-22T08:00:00.000Z")
    });

    const pending = await repository.createPendingRegistration({
      employeeId: 1,
      deviceToken: "new-token",
      deviceLabel: "New phone",
      expiresAt: new Date("2026-06-22T11:00:00.000Z")
    });

    const active = await repository.activatePendingRegistration(pending.id, {
      browserFingerprint: "new-fingerprint",
      registeredAt: new Date("2026-06-22T10:30:00.000Z")
    });
    assertRegistration(active);

    await repository.replaceActiveRegistrations(1, active.id, new Date("2026-06-22T10:31:00.000Z"));

    const activeRow = await repository.findActiveRegistration(1);
    const replacedRow = await databaseClient.db.select().from(employeeDeviceRegistrations).where(
      and(
        eq(employeeDeviceRegistrations.employeeId, 1),
        eq(employeeDeviceRegistrations.deviceToken, "old-active")
      )
    );

    expect(activeRow).toMatchObject({
      id: pending.id,
      status: "active",
      browserFingerprint: "new-fingerprint"
    });
    expect(replacedRow[0]).toMatchObject({
      status: "replaced"
    });
  });

  it("revokes pending and active registrations for an employee", async () => {
    const repository = createDrizzleEmployeeDeviceRepository({
      db: databaseClient.db
    });

    await repository.createPendingRegistration({
      employeeId: 1,
      deviceToken: "pending-token",
      deviceLabel: "Pending phone",
      expiresAt: new Date("2026-06-22T11:00:00.000Z")
    });
    const activeInsert = await databaseClient.db.insert(employeeDeviceRegistrations).values({
      employeeId: 1,
      deviceToken: "active-token",
      deviceLabel: "Active phone",
      browserFingerprint: "fingerprint",
      status: "active",
      registeredAt: new Date("2026-06-22T08:00:00.000Z")
    });

    const changed = await repository.revokeDeviceAccess(1, new Date("2026-06-22T09:00:00.000Z"));
    const rows = await databaseClient.db.select().from(employeeDeviceRegistrations).where(eq(employeeDeviceRegistrations.employeeId, 1));

    expect(activeInsert[0].insertId).toBeGreaterThan(0);
    expect(changed).toBe(true);
    expect(rows.map((row) => row.status)).toEqual(["revoked", "revoked"]);
  });
});

function assertRegistration(value: EmployeeDeviceRegistrationRecord | null): asserts value is EmployeeDeviceRegistrationRecord {
  expect(value).not.toBeNull();

  if (!value) {
    throw new Error("expected registration");
  }
}
