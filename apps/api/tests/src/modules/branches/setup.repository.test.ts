import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../../../../src/db/client";
import {
  admins,
  branchSetupLinks,
  branches
} from "../../../../src/db/schema";
import { createDrizzleBranchRepository } from "../../../../src/modules/branches/repository";
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
    gpsLatitude: "30.0500000",
    gpsLongitude: "31.2500000",
    gpsRadiusMeters: 100,
    allowedIpCidr: "192.168.1.0/24",
    setupStatus: "setup_pending"
  });
});

afterAll(async () => {
  await databaseClient.close();
});

describe("branch setup repository", () => {
  it("creates and loads a pending setup link", async () => {
    const repository = createDrizzleBranchRepository({ db: databaseClient.db });

    const created = await repository.createSetupLink({
      branchId: 1,
      token: "setup-token",
      deviceLabel: "Reception iPad",
      expiresAt: new Date("2026-06-22T12:00:00.000Z"),
      createdByAdminId: 1
    });

    expect(created.token).toBe("setup-token");
    await expect(repository.findPendingSetupLinkByToken("setup-token")).resolves.toMatchObject({
      token: "setup-token",
      deviceLabel: "Reception iPad"
    });
  });

  it("activates a branch device and updates the branch status", async () => {
    const repository = createDrizzleBranchRepository({ db: databaseClient.db });
    await databaseClient.db.insert(branchSetupLinks).values({
      branchId: 1,
      token: "setup-token",
      status: "active",
      expiresAt: new Date("2026-06-22T12:00:00.000Z"),
      createdByAdminId: 1
    });

    const device = await repository.activateSetupLink("setup-token", {
      deviceLabel: "Reception iPad",
      browserFingerprint: "branch-browser",
      registeredAt: new Date("2026-06-22T10:00:00.000Z")
    });

    expect(device?.browserFingerprint).toBe("branch-browser");
    await expect(repository.findActiveRegistration(1)).resolves.toMatchObject({
      deviceLabel: "Reception iPad",
      browserFingerprint: "branch-browser"
    });
    await expect(repository.findBranchById(1)).resolves.toMatchObject({
      setupStatus: "completed",
      registeredDeviceToken: expect.any(String)
    });
  });

  it("revokes pending setup links", async () => {
    const repository = createDrizzleBranchRepository({ db: databaseClient.db });
    await databaseClient.db.insert(branchSetupLinks).values({
      branchId: 1,
      token: "setup-token",
      status: "active",
      expiresAt: new Date("2026-06-22T12:00:00.000Z"),
      createdByAdminId: 1
    });

    await repository.revokePendingSetupLinks(1, new Date("2026-06-22T11:00:00.000Z"));

    const links = await databaseClient.db.select().from(branchSetupLinks);
    expect(links[0]?.status).toBe("revoked");
  });
});
