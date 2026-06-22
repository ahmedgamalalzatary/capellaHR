import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { branches, employees } from "../../../../src/db/schema";
import { createDrizzleEmployeeRepository } from "../../../../src/modules/employees/repository";
import {
  assertEmployeeRecord,
  seedNasrCityBranch,
  setupEmployeeRepositoryTest
} from "./employee-repository.fixtures";

const databaseClient = setupEmployeeRepositoryTest();

describe("drizzle employee repository (query)", () => {
  it("soft deletes an employee without removing the record", async () => {
    const repository = createDrizzleEmployeeRepository({
      db: databaseClient.db
    });

    await seedNasrCityBranch(databaseClient.db);

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

    await seedNasrCityBranch(databaseClient.db);

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
});
