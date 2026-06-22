import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createDatabaseClient } from "../../../../src/db/client";
import { branches } from "../../../../src/db/schema";
import { resetTestDatabase } from "../../../../src/test/reset-database";
import { createDrizzleBranchRepository, type BranchRecord } from "../../../../src/modules/branches/repository";

loadEnv({
  path: resolve(process.cwd(), "../../.env.test"),
  override: true
});

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseClient = createDatabaseClient({
  databaseUrl
});

beforeAll(async () => {
  await databaseClient.db.execute("SELECT 1");
});

beforeEach(async () => {
  await resetTestDatabase(databaseClient.db);
});

afterAll(async () => {
  await databaseClient.close();
});

describe("drizzle branch repository", () => {
  it("creates and loads a branch", async () => {
    const repository = createDrizzleBranchRepository({
      db: databaseClient.db
    });

    const created = await repository.createBranch({
      name: "Nasr City",
      address: "Cairo",
      gpsLatitude: "30.0500000",
      gpsLongitude: "31.2500000",
      gpsRadiusMeters: 100,
      allowedIpCidr: "192.168.1.0/24",
      setupStatus: "setup_pending"
    });

    expect(created).toEqual({
      id: expect.any(Number),
      name: "Nasr City",
      address: "Cairo",
      gpsLatitude: "30.0500000",
      gpsLongitude: "31.2500000",
      gpsRadiusMeters: 100,
      allowedIpCidr: "192.168.1.0/24",
      registeredDeviceToken: null,
      setupStatus: "setup_pending"
    });

    const loaded = await repository.findBranchById(created.id);

    expect(loaded).toEqual(created);
  });

  it("lists branches by name search with pagination metadata", async () => {
    const repository = createDrizzleBranchRepository({
      db: databaseClient.db
    });

    await databaseClient.db.insert(branches).values([
      {
        name: "Nasr City",
        address: "Cairo",
        gpsLatitude: "30.0500000",
        gpsLongitude: "31.2500000",
        gpsRadiusMeters: 100,
        allowedIpCidr: "192.168.1.0/24",
        setupStatus: "completed"
      },
      {
        name: "Maadi",
        address: "Cairo",
        gpsLatitude: "30.0000000",
        gpsLongitude: "31.2000000",
        gpsRadiusMeters: 80,
        allowedIpCidr: "192.168.2.0/24",
        setupStatus: "setup_pending"
      }
    ]);

    const result = await repository.listBranches({
      page: 1,
      pageSize: 10,
      search: "nasr"
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe("Nasr City");
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1
    });
  });

  it("updates a branch", async () => {
    const repository = createDrizzleBranchRepository({
      db: databaseClient.db
    });

    await databaseClient.db.insert(branches).values({
      id: 1,
      name: "Nasr City",
      address: "Cairo",
      gpsLatitude: "30.0500000",
      gpsLongitude: "31.2500000",
      gpsRadiusMeters: 100,
      allowedIpCidr: "192.168.1.0/24",
      setupStatus: "setup_pending"
    });

    const updated = await repository.updateBranch(1, {
      name: "Nasr City Updated",
      setupStatus: "completed"
    });
    assertBranchRecord(updated);

    expect(updated.name).toBe("Nasr City Updated");
    expect(updated.setupStatus).toBe("completed");

    const rows = await databaseClient.db.select().from(branches).where(eq(branches.id, 1));
    expect(rows[0]?.name).toBe("Nasr City Updated");
  });
});

function assertBranchRecord(branch: BranchRecord | null): asserts branch is BranchRecord {
  expect(branch).not.toBeNull();
}
