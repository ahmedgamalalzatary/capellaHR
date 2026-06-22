import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createDatabaseClient } from "../../db/client";
import {
  adminSessions,
  admins,
  branches,
  employeeFiles,
  employeeSessions,
  employees,
  salaryHistory
} from "../../db/schema";
import { createDrizzleEmployeeRepository } from "./repository";

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
  await databaseClient.db.delete(employeeFiles);
  await databaseClient.db.delete(salaryHistory);
  await databaseClient.db.delete(employees);
  await databaseClient.db.delete(branches);
  await databaseClient.db.delete(admins);
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

describe("drizzle employee repository", () => {
  it("creates an employee and writes the initial salary history entry", async () => {
    const repository = createDrizzleEmployeeRepository({
      db: databaseClient.db
    });

    const branchResult = await databaseClient.db.insert(branches).values({
      name: "Nasr City",
      address: "Cairo",
      gpsLatitude: "30.0500000",
      gpsLongitude: "31.2500000",
      gpsRadiusMeters: 100,
      allowedIpCidr: "192.168.1.0/24",
      setupStatus: "completed"
    });

    const branchId = Number(branchResult[0].insertId);
    const employee = await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550001",
      whatsappPhone: "01055550002",
      email: "mina-employees-1@capella.eg",
      branchId,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });

    expect(employee).toEqual({
      id: expect.any(Number),
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550001",
      whatsappPhone: "01055550002",
      email: "mina-employees-1@capella.eg",
      branchId,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      softDeletedAt: null
    });

    const salaryRows = await databaseClient.db
      .select()
      .from(salaryHistory)
      .where(eq(salaryHistory.employeeId, employee.id));

    expect(salaryRows).toHaveLength(1);
    expect(String(salaryRows[0]?.amount)).toBe("10000.00");
  });

  it("updates an employee salary and writes a new salary history entry", async () => {
    const repository = createDrizzleEmployeeRepository({
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
      setupStatus: "completed"
    });

    const created = await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550003",
      whatsappPhone: "01055550004",
      email: "mina-employees-2@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });

    const updated = await repository.updateEmployee(created.id, {
      currentMonthlySalary: "12000.00"
    }, 1);

    expect(updated?.currentMonthlySalary).toBe("12000.00");

    const salaryRows = await databaseClient.db
      .select()
      .from(salaryHistory)
      .where(eq(salaryHistory.employeeId, created.id));

    expect(salaryRows).toHaveLength(2);
    expect(String(salaryRows[1]?.amount)).toBe("12000.00");
  });

  it("soft deletes an employee without removing the record", async () => {
    const repository = createDrizzleEmployeeRepository({
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
      setupStatus: "completed"
    });

    const created = await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550005",
      whatsappPhone: "01055550006",
      email: "mina-employees-3@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });

    const deleted = await repository.softDeleteEmployee(created.id);

    expect(deleted).toBe(true);

    const rows = await databaseClient.db.select().from(employees).where(eq(employees.id, created.id));

    expect(rows[0]?.softDeletedAt).toBeInstanceOf(Date);
  });
});
