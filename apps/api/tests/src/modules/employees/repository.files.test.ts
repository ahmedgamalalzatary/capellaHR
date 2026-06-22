import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { employeeFiles } from "../../../../src/db/schema";
import { createDrizzleEmployeeRepository } from "../../../../src/modules/employees/repository";
import {
  assertEmployeeFileRecord,
  assertEmployeeRecord,
  seedNasrCityBranch,
  setupEmployeeRepositoryTest
} from "./employee-repository.fixtures";

const databaseClient = setupEmployeeRepositoryTest();

describe("drizzle employee repository (files)", () => {
  it("stores employee file metadata and lists the active files", async () => {
    const repository = createDrizzleEmployeeRepository({
      db: databaseClient.db
    });

    await seedNasrCityBranch(databaseClient.db);

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

    await seedNasrCityBranch(databaseClient.db);

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
