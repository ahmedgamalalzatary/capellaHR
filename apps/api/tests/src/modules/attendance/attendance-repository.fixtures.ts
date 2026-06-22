import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createDatabaseClient, resetDatabaseClient } from "../../../../src/db/client";
import {
  admins,
  branches,
  employees
} from "../../../../src/db/schema";
import { resetTestDatabase } from "../../../../src/test/reset-database";

loadEnv({
  path: resolve(process.cwd(), "../../.env.test"),
  override: true
});

export function setupAttendanceRepositoryTest() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required to run this test. Ensure .env.test exists in the project root with DATABASE_URL defined."
    );
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

  afterAll(async () => {
    await databaseClient.close();
    await resetDatabaseClient();
  });

  return databaseClient;
}
