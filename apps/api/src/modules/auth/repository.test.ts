import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createDatabaseClient } from "../../db/client";
import { adminSessions, admins, employeeSessions, employees } from "../../db/schema";
import {
  createDrizzleAuthRepository,
  syncBootstrapAdmin
} from "./repository";

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
  await databaseClient.db.delete(adminSessions);
  await databaseClient.db.delete(employeeSessions);
  await databaseClient.db.delete(employees);
  await databaseClient.db.delete(admins);
});

afterAll(async () => {
  await databaseClient.close();
});

describe("drizzle auth repository", () => {
  it("syncs the bootstrap admin into the database and finds it by email", async () => {
    const repository = createDrizzleAuthRepository({
      db: databaseClient.db
    });

    await syncBootstrapAdmin(repository, {
      name: "Capella Admin Test",
      email: "admin-test@capella.eg",
      password: "admin1234"
    });

    const admin = await repository.findAdminByEmail("admin-test@capella.eg");

    expect(admin).toEqual({
      id: expect.any(Number),
      name: "Capella Admin Test",
      email: "admin-test@capella.eg",
      passwordHash: expect.any(String)
    });
  });

  it("stores and revokes an admin session in the database", async () => {
    const repository = createDrizzleAuthRepository({
      db: databaseClient.db
    });

    await syncBootstrapAdmin(repository, {
      name: "Capella Admin Test",
      email: "admin-test@capella.eg",
      password: "admin1234"
    });

    const admin = await repository.findAdminByEmail("admin-test@capella.eg");

    if (!admin) {
      throw new Error("expected bootstrap admin to exist");
    }

    await repository.insertSession({
      tokenHash: "admin-token-hash",
      actorId: admin.id,
      actorRole: "admin",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      revokedAt: null
    });

    const storedSession = await repository.findSessionByTokenHash("admin-token-hash");

    expect(storedSession).toEqual({
      tokenHash: "admin-token-hash",
      actorId: admin.id,
      actorRole: "admin",
      expiresAt: expect.any(Date),
      revokedAt: null
    });

    const revoked = await repository.revokeSessionByTokenHash(
      "admin-token-hash",
      new Date("2030-01-02T00:00:00.000Z")
    );

    expect(revoked).toBe(true);

    const updatedRows = await databaseClient.db
      .select()
      .from(adminSessions)
      .where(eq(adminSessions.tokenHash, "admin-token-hash"));

    expect(updatedRows[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it("finds an employee by phone and revokes active employee sessions", async () => {
    const repository = createDrizzleAuthRepository({
      db: databaseClient.db
    });

    const insertedEmployee = await databaseClient.db.insert(employees).values({
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01012345678",
      whatsappPhone: "01012345679",
      email: "mina@capella.eg",
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00"
    });

    const employeeId = Number(insertedEmployee[0].insertId);
    const employee = await repository.findEmployeeByPhone("01012345678");

    expect(employee).toEqual({
      id: employeeId,
      fullName: "Mina Adel",
      primaryPhone: "01012345678",
      passwordHash: "plain:secret123",
      softDeletedAt: null
    });

    await repository.insertSession({
      tokenHash: "employee-token-hash",
      actorId: employeeId,
      actorRole: "employee",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      revokedAt: null
    });

    await repository.revokeActiveSessionsForActor(
      "employee",
      employeeId,
      new Date("2029-12-31T00:00:00.000Z")
    );

    const updatedRows = await databaseClient.db
      .select()
      .from(employeeSessions)
      .where(eq(employeeSessions.tokenHash, "employee-token-hash"));

    expect(updatedRows[0]?.revokedAt).toBeInstanceOf(Date);
  });
});
