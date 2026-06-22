import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendanceSessions, branches, employeeBranchAssignments, employees } from "../../../../src/db/schema";
import { createDrizzleEmployeeRepository } from "../../../../src/modules/employees/repository";
import {
  assertEmployeeRecord,
  seedNasrCityBranch,
  setupEmployeeRepositoryTest
} from "./employee-repository.fixtures";

const databaseClient = setupEmployeeRepositoryTest();

describe("drizzle employee repository (branch assignments)", () => {
  it("creates an initial branch assignment for new employees", async () => {
    const repository = createDrizzleEmployeeRepository({ db: databaseClient.db });
    await seedNasrCityBranch(databaseClient.db);

    const employee = await repository.createEmployee({
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550101",
      whatsappPhone: "01055550102",
      email: "mina-assignments-1@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00",
      createdByAdminId: 1
    });
    assertEmployeeRecord(employee);

    const assignments = await databaseClient.db.select().from(employeeBranchAssignments).where(
      eq(employeeBranchAssignments.employeeId, employee.id)
    );

    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.branchId).toBe(1);
  });

  it("creates future branch assignments without changing the current employee branch", async () => {
    const repository = createDrizzleEmployeeRepository({ db: databaseClient.db });
    await seedNasrCityBranch(databaseClient.db);
    await databaseClient.db.insert(employees).values({
      id: 1,
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550103",
      whatsappPhone: "01055550104",
      email: "mina-assignments-2@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00"
    });
    await databaseClient.db.insert(branches).values({
      id: 2,
      name: "Heliopolis",
      address: "Cairo",
      gpsLatitude: "30.1000000",
      gpsLongitude: "31.3000000",
      gpsRadiusMeters: 150,
      allowedIpCidr: "192.168.10.0/24",
      setupStatus: "completed"
    });

    const assignment = await repository.createBranchAssignment({
      employeeId: 1,
      branchId: 2,
      effectiveFrom: new Date("2026-06-23T10:00:00.000Z"),
      assignedByAdminId: 1,
      applyImmediately: false
    });

    expect(assignment.branchId).toBe(2);
    await expect(repository.findEmployeeById(1)).resolves.toMatchObject({ branchId: 1 });
  });

  it("applies due branch assignments after checkout", async () => {
    const repository = createDrizzleEmployeeRepository({ db: databaseClient.db });
    await seedNasrCityBranch(databaseClient.db);
    await databaseClient.db.insert(employees).values({
      id: 1,
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01055550105",
      whatsappPhone: "01055550106",
      email: "mina-assignments-3@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000.00"
    });
    await databaseClient.db.insert(branches).values({
      id: 2,
      name: "Heliopolis",
      address: "Cairo",
      gpsLatitude: "30.1000000",
      gpsLongitude: "31.3000000",
      gpsRadiusMeters: 150,
      allowedIpCidr: "192.168.10.0/24",
      setupStatus: "completed"
    });
    await databaseClient.db.insert(employeeBranchAssignments).values({
      employeeId: 1,
      branchId: 1,
      effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      assignedByAdminId: 1
    });
    await databaseClient.db.insert(attendanceSessions).values({
      employeeId: 1,
      branchId: 1,
      status: "open",
      checkInAtUtc: new Date("2026-06-22T08:00:00.000Z"),
      checkInLatitude: "30.0444200",
      checkInLongitude: "31.2357120",
      checkInIpAddress: "192.168.1.42",
      deviceId: "device-1",
      branchPolicySnapshot: {}
    });

    await repository.createBranchAssignment({
      employeeId: 1,
      branchId: 2,
      effectiveFrom: new Date("2026-06-22T10:00:00.000Z"),
      assignedByAdminId: 1,
      applyImmediately: false
    });

    await repository.applyPendingBranchAssignment(1, new Date("2026-06-22T12:00:00.000Z"));

    await expect(repository.findEmployeeById(1)).resolves.toMatchObject({ branchId: 2 });
  });
});
