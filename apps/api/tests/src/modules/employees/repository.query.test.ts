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
      passwordHash: "plain:test-employee-pass-123",
      primaryPhone: "01055550005",
      whatsappPhone: "01055550006",
      email: "mina-employees-3@capella.invalid",
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

  it("lists employees filtered by search, branch, and status with pagination metadata", async () => {
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
      passwordHash: "plain:test-employee-pass-123",
      primaryPhone: "01055550007",
      whatsappPhone: "01055550008",
      email: "mina-employees-4@capella.invalid",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });

    const softDeleted = await repository.createEmployee({
      fullName: "Sara Nabil",
      passwordHash: "plain:test-employee-pass-123",
      primaryPhone: "01055550009",
      whatsappPhone: "01055550010",
      email: "sara-employees-1@capella.invalid",
      branchId: 2,
      age: 27,
      address: "Giza",
      currentMonthlySalary: "9000.00",
      createdByAdminId: 1
    });
    assertEmployeeRecord(softDeleted);

    await repository.softDeleteEmployee(softDeleted.id);

    const activeRows = await repository.listEmployees({
      page: 1,
      pageSize: 10,
      search: "Mina",
      branchId: 1,
      status: "active"
    });
    const softDeletedRows = await repository.listEmployees({
      page: 1,
      pageSize: 10,
      status: "soft_deleted"
    });

    expect(activeRows.items).toHaveLength(1);
    expect(activeRows.items[0]?.fullName).toBe("Mina Adel");
    expect(activeRows.pagination).toEqual({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1
    });
    expect(softDeletedRows.items).toHaveLength(1);
    expect(softDeletedRows.items[0]?.fullName).toBe("Sara Nabil");
    expect(softDeletedRows.items[0]?.softDeletedAt).toBeInstanceOf(Date);
    expect(softDeletedRows.pagination).toEqual({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1
    });
  });

  it("applies offset pagination for employees", async () => {
    const repository = createDrizzleEmployeeRepository({
      db: databaseClient.db
    });

    await seedNasrCityBranch(databaseClient.db);

    await repository.createEmployee({
      fullName: "A Employee",
      passwordHash: "plain:test-employee-pass-123",
      primaryPhone: "01055550101",
      whatsappPhone: "01055550102",
      email: "employee-a@capella.invalid",
      branchId: 1,
      age: 20,
      address: "Cairo",
      currentMonthlySalary: "1000.00",
      createdByAdminId: 1
    });

    await repository.createEmployee({
      fullName: "B Employee",
      passwordHash: "plain:test-employee-pass-123",
      primaryPhone: "01055550103",
      whatsappPhone: "01055550104",
      email: "employee-b@capella.invalid",
      branchId: 1,
      age: 21,
      address: "Cairo",
      currentMonthlySalary: "1000.00",
      createdByAdminId: 1
    });

    await repository.createEmployee({
      fullName: "C Employee",
      passwordHash: "plain:test-employee-pass-123",
      primaryPhone: "01055550105",
      whatsappPhone: "01055550106",
      email: "employee-c@capella.invalid",
      branchId: 1,
      age: 22,
      address: "Cairo",
      currentMonthlySalary: "1000.00",
      createdByAdminId: 1
    });

    const pageTwo = await repository.listEmployees({
      page: 2,
      pageSize: 2
    });

    expect(pageTwo.items).toHaveLength(1);
    expect(pageTwo.items[0]?.fullName).toBe("C Employee");
    expect(pageTwo.pagination).toEqual({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2
    });
  });

  it("loads an employee by id", async () => {
    const repository = createDrizzleEmployeeRepository({
      db: databaseClient.db
    });

    await seedNasrCityBranch(databaseClient.db);

    const created = await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:test-employee-pass-123",
      primaryPhone: "01055550011",
      whatsappPhone: "01055550012",
      email: "mina-employees-5@capella.invalid",
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
