import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { salaryHistory } from "../../../../src/db/schema";
import { createDrizzleEmployeeRepository } from "../../../../src/modules/employees/repository";
import {
  assertEmployeeRecord,
  seedNasrCityBranch,
  setupEmployeeRepositoryTest
} from "./employee-repository.fixtures";

const databaseClient = setupEmployeeRepositoryTest();

describe("drizzle employee repository (create)", () => {
  it("creates an employee and writes the initial salary history entry", async () => {
    const repository = createDrizzleEmployeeRepository({
      db: databaseClient.db
    });

    await seedNasrCityBranch(databaseClient.db);

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

  it("maps duplicate employee fields on create into a repository conflict", async () => {
    const repository = createDrizzleEmployeeRepository({
      db: databaseClient.db
    });

    await seedNasrCityBranch(databaseClient.db);

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
});
