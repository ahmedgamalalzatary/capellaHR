import { config as loadEnv } from "dotenv";
import { afterAll, beforeAll, beforeEach, expect } from "vitest";
import { resolve } from "node:path";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { createDatabaseClient } from "../../../../src/db/client";
import { admins, branches } from "../../../../src/db/schema";
import { resetTestDatabase } from "../../../../src/test/reset-database";
import type { EmployeeFileRecord, EmployeeRecord } from "../../../../src/modules/employees/repository";

loadEnv({
  path: resolve(process.cwd(), "../../.env.test"),
  override: true
});

type DatabaseSchema = typeof import("../../../../src/db/schema");

export function setupEmployeeRepositoryTest() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
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
      email: "employees-admin-test@capella.eg",
      passwordHash: "plain:admin1234"
    });
  });

  afterAll(async () => {
    await databaseClient.close();
  });

  return databaseClient;
}

export async function seedNasrCityBranch(db: MySql2Database<DatabaseSchema>) {
  await db.insert(branches).values({
    id: 1,
    name: "Nasr City",
    address: "Cairo",
    gpsLatitude: "30.0500000",
    gpsLongitude: "31.2500000",
    gpsRadiusMeters: 100,
    allowedIpCidr: "192.168.1.0/24",
    setupStatus: "completed"
  });
}

export function assertEmployeeRecord(
  value: EmployeeRecord | { error: { code: "EMPLOYEE_CONFLICT"; field: "primary_phone" | "whatsapp_phone" | "email" } } | null
): asserts value is EmployeeRecord {
  expect(value).not.toBeNull();

  if (!value) {
    throw new Error("expected employee record");
  }

  expect("error" in value).toBe(false);
}

export function assertEmployeeFileRecord(value: EmployeeFileRecord | null): asserts value is EmployeeFileRecord {
  expect(value).not.toBeNull();

  if (!value) {
    throw new Error("expected employee file record");
  }
}
