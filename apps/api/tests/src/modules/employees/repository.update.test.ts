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

describe("drizzle employee repository (update)", () => {
  it("updates an employee salary and writes a new salary history entry", async () => {
    const repository = createDrizzleEmployeeRepository({
      db: databaseClient.db
    });

    await seedNasrCityBranch(databaseClient.db);

    const created = await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:test-employee-pass-123",
      primaryPhone: "01055550003",
      whatsappPhone: "01055550004",
      email: "mina-employees-2@capella.invalid",
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

  it("maps duplicate employee fields on update into a repository conflict", async () => {
    const repository = createDrizzleEmployeeRepository({
      db: databaseClient.db
    });

    await seedNasrCityBranch(databaseClient.db);

    await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:test-employee-pass-123",
      primaryPhone: "01055550016",
      whatsappPhone: "01055550017",
      email: "mina-employees-8@capella.invalid",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });

    const created = await repository.createEmployee({
      fullName: "Sara Nabil",
      passwordHash: "plain:test-employee-pass-123",
      primaryPhone: "01055550018",
      whatsappPhone: "01055550019",
      email: "sara-employees-2@capella.invalid",
      branchId: 1,
      age: 27,
      address: "Giza",
      currentMonthlySalary: "9000.00",
      createdByAdminId: 1
    });
    assertEmployeeRecord(created);

    const result = await repository.updateEmployee(created.id, {
      email: "mina-employees-8@capella.invalid"
    }, 1);

    expect(result).toEqual({
      error: {
        code: "EMPLOYEE_CONFLICT",
        field: "email"
      }
    });
  });
});
