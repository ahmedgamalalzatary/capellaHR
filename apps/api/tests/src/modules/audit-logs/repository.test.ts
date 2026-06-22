import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../../../../src/db/client";
import { admins } from "../../../../src/db/schema";
import { createDrizzleAuditLogRepository } from "../../../../src/modules/audit-logs/repository";
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
    email: "admin@capella.eg",
    passwordHash: "plain:admin1234"
  });
});

afterAll(async () => {
  await databaseClient.close();
});

describe("audit log repository", () => {
  it("creates and lists audit logs", async () => {
    const repository = createDrizzleAuditLogRepository({
      db: databaseClient.db
    });

    const created = await repository.createAuditLog({
      adminId: 1,
      actionType: "create",
      entityType: "attendance",
      entityId: "42",
      entityDisplayName: "Ahmed Gamal",
      reason: "manual correction",
      before: null,
      after: { status: "completed" },
      occurredAtUtc: new Date("2026-06-22T08:00:00.000Z")
    });

    expect(created.entityType).toBe("attendance");

    const rows = await repository.listAuditLogs({
      entityType: "attendance"
    });
    expect(rows).toHaveLength(1);
  });
});
