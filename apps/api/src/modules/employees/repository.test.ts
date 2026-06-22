import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createDatabaseClient } from "../../db/client";
import { admins, branches, employeeFiles, employees, salaryHistory } from "../../db/schema";
import { resetTestDatabase } from "../../test/reset-database";
import { createDrizzleEmployeeRepository, type EmployeeFileRecord, type EmployeeRecord } from "./repository";

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

    const branchId = 1;
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
    assertEmployeeRecord(employee);

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
    assertEmployeeRecord(created);

    const updated = await repository.updateEmployee(created.id, {
      currentMonthlySalary: "12000.00"
    }, 1);
    assertEmployeeRecord(updated);

    expect(updated.currentMonthlySalary).toBe("12000.00");

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
    assertEmployeeRecord(created);

    const deleted = await repository.softDeleteEmployee(created.id);

    expect(deleted).toBe(true);

    const rows = await databaseClient.db.select().from(employees).where(eq(employees.id, created.id));

    expect(rows[0]?.softDeletedAt).toBeInstanceOf(Date);
  });

  it("lists employees filtered by search, branch, and status", async () => {
    const repository = createDrizzleEmployeeRepository({
      db: databaseClient.db
    });

    await databaseClient.db.insert(branches).values([
      {
        id: 1,
        name: "Nasr City",
        address: "Cairo",
        gpsLatitude: "30.0500000",
        gpsLongitude: "31.2500000",
        gpsRadiusMeters: 100,
        allowedIpCidr: "192.168.1.0/24",
        setupStatus: "completed"
      },
      {
        id: 2,
        name: "Heliopolis",
        address: "Cairo",
        gpsLatitude: "30.0600000",
        gpsLongitude: "31.2600000",
        gpsRadiusMeters: 100,
        allowedIpCidr: "192.168.2.0/24",
        setupStatus: "completed"
      }
    ]);

    await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550007",
      whatsappPhone: "01055550008",
      email: "mina-employees-4@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });

    const softDeleted = await repository.createEmployee({
      fullName: "Sara Nabil",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550009",
      whatsappPhone: "01055550010",
      email: "sara-employees-1@capella.eg",
      branchId: 2,
      age: 27,
      address: "Giza",
      currentMonthlySalary: "9000.00",
      createdByAdminId: 1
    });
    assertEmployeeRecord(softDeleted);

    await repository.softDeleteEmployee(softDeleted.id);

    const activeRows = await repository.listEmployees({
      search: "Mina",
      branchId: 1,
      status: "active"
    });
    const softDeletedRows = await repository.listEmployees({
      status: "soft_deleted"
    });

    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]?.fullName).toBe("Mina Adel");
    expect(softDeletedRows).toHaveLength(1);
    expect(softDeletedRows[0]?.fullName).toBe("Sara Nabil");
    expect(softDeletedRows[0]?.softDeletedAt).toBeInstanceOf(Date);
  });

  it("loads an employee by id", async () => {
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
      primaryPhone: "01055550011",
      whatsappPhone: "01055550012",
      email: "mina-employees-5@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });
    assertEmployeeRecord(created);

    const employee = await repository.findEmployeeById(created.id);

    expect(employee).toEqual(created);
  });

  it("maps duplicate employee fields on create into a repository conflict", async () => {
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

    await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550013",
      whatsappPhone: "01055550014",
      email: "mina-employees-6@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });

    const result = await repository.createEmployee({
      fullName: "Other Mina",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550013",
      whatsappPhone: "01055550015",
      email: "mina-employees-7@capella.eg",
      branchId: 1,
      age: 29,
      address: "Alex",
      currentMonthlySalary: "11000.00",
      createdByAdminId: 1
    });

    expect(result).toEqual({
      error: {
        code: "EMPLOYEE_CONFLICT",
        field: "primary_phone"
      }
    });
  });

  it("maps duplicate employee fields on update into a repository conflict", async () => {
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

    await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550016",
      whatsappPhone: "01055550017",
      email: "mina-employees-8@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });

    const created = await repository.createEmployee({
      fullName: "Sara Nabil",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550018",
      whatsappPhone: "01055550019",
      email: "sara-employees-2@capella.eg",
      branchId: 1,
      age: 27,
      address: "Giza",
      currentMonthlySalary: "9000.00",
      createdByAdminId: 1
    });
    assertEmployeeRecord(created);

    const result = await repository.updateEmployee(created.id, {
      email: "mina-employees-8@capella.eg"
    }, 1);

    expect(result).toEqual({
      error: {
        code: "EMPLOYEE_CONFLICT",
        field: "email"
      }
    });
  });

  it("stores employee file metadata and lists the active files", async () => {
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

    const employee = await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550020",
      whatsappPhone: "01055550021",
      email: "mina-employees-9@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });
    assertEmployeeRecord(employee);

    const files = await repository.insertEmployeeFiles(employee.id, [
      {
        fileType: "personal_photo",
        storagePath: "1/personal_photo/photo.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 128
      },
      {
        fileType: "id_front",
        storagePath: "1/id_front/front.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 256
      }
    ]);

    expect(files).toHaveLength(2);

    const activeFiles = await repository.listEmployeeFiles(employee.id);

    expect(activeFiles).toEqual([
      {
        id: expect.any(Number),
        employeeId: employee.id,
        fileType: "personal_photo",
        storagePath: "1/personal_photo/photo.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 128,
        replacedAt: null
      },
      {
        id: expect.any(Number),
        employeeId: employee.id,
        fileType: "id_front",
        storagePath: "1/id_front/front.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 256,
        replacedAt: null
      }
    ]);
  });

  it("replaces an employee file and keeps the previous record as history", async () => {
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

    const employee = await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550022",
      whatsappPhone: "01055550023",
      email: "mina-employees-10@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });
    assertEmployeeRecord(employee);

    await repository.insertEmployeeFiles(employee.id, [
      {
        fileType: "personal_photo",
        storagePath: "1/personal_photo/original.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 128
      }
    ]);

    const replaced = await repository.replaceEmployeeFile(employee.id, "personal_photo", {
      storagePath: "1/personal_photo/replacement.jpg",
      mimeType: "image/jpeg",
      fileSizeBytes: 512
    });
    assertEmployeeFileRecord(replaced);

    expect(replaced).toEqual({
      id: expect.any(Number),
      employeeId: employee.id,
      fileType: "personal_photo",
      storagePath: "1/personal_photo/replacement.jpg",
      mimeType: "image/jpeg",
      fileSizeBytes: 512,
      replacedAt: null
    });

    const historyRows = await databaseClient.db
      .select()
      .from(employeeFiles)
      .where(eq(employeeFiles.employeeId, employee.id));

    expect(historyRows).toHaveLength(2);
    expect(historyRows[0]?.replacedAt).toBeInstanceOf(Date);
  });
});

function assertEmployeeRecord(
  value: EmployeeRecord | { error: { code: "EMPLOYEE_CONFLICT"; field: "primary_phone" | "whatsapp_phone" | "email" } } | null
): asserts value is EmployeeRecord {
  expect(value).not.toBeNull();

  if (!value) {
    throw new Error("expected employee record");
  }

  expect("error" in value).toBe(false);
}

function assertEmployeeFileRecord(value: EmployeeFileRecord | null): asserts value is EmployeeFileRecord {
  expect(value).not.toBeNull();

  if (!value) {
    throw new Error("expected employee file record");
  }
}
