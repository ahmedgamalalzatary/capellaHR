import { describe, expect, it } from "vitest";
import { createEmployeeService } from "../../../../src/modules/employees/service";
import { InMemoryAuditLogService } from "../audit-logs/audit-log-test.fixtures";
import {
  InMemoryEmployeeFileStorage,
  InMemoryEmployeeRepository,
  createUploadedFile
} from "./employee-service.fixtures";

describe("employee service (files)", () => {
  it("lists the current employee files", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.employeeFiles = [
      {
        id: 1,
        employeeId: 1,
        fileType: "personal_photo",
        storagePath: "employees/1/personal_photo/one.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 128,
        replacedAt: null
      }
    ];
    const service = createEmployeeService({
      repository,
      fileStorage: new InMemoryEmployeeFileStorage()
    });

    const result = await service.listEmployeeFiles(1);

    expect(result).toEqual({
      files: [
        {
          id: 1,
          fileType: "personal_photo",
          mimeType: "image/jpeg",
          fileSizeBytes: 128,
          replacedAt: null
        }
      ]
    });
  });

  it("loads an employee file for download", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.employeeFiles = [
      {
        id: 1,
        employeeId: 1,
        fileType: "personal_photo",
        storagePath: "employees/1/personal_photo/one.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 128,
        replacedAt: null
      }
    ];
    const storage = new InMemoryEmployeeFileStorage();
    storage.fileContents.set("employees/1/personal_photo/one.jpg", Buffer.from("file-bytes"));
    const service = createEmployeeService({
      repository,
      fileStorage: storage
    });

    const result = await service.getEmployeeFile(1, 1);

    expect(result).toEqual({
      file: {
        id: 1,
        fileType: "personal_photo",
        mimeType: "image/jpeg",
        fileSizeBytes: 128,
        replacedAt: null
      },
      content: Buffer.from("file-bytes")
    });
  });

  it("replaces an employee file and preserves history", async () => {
    const repository = new InMemoryEmployeeRepository();
    repository.employeeFiles = [
      {
        id: 1,
        employeeId: 1,
        fileType: "personal_photo",
        storagePath: "employees/1/personal_photo/one.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 128,
        replacedAt: null
      }
    ];
    const storage = new InMemoryEmployeeFileStorage();
    const auditLogService = new InMemoryAuditLogService();
    const service = createEmployeeService({
      repository,
      fileStorage: storage,
      auditLogService
    });

    const result = await service.replaceEmployeeFile(1, "personal_photo", createUploadedFile("personal_photo"), 1);

    expect(result).toEqual({
      file: {
        id: 2,
        fileType: "personal_photo",
        mimeType: "image/jpeg",
        fileSizeBytes: 12,
        replacedAt: null
      }
    });
    expect(repository.employeeFiles[0]?.replacedAt).toBeInstanceOf(Date);
    expect(storage.savedFiles).toHaveLength(1);
    expect(auditLogService.logs[0]).toMatchObject({
      actionType: "update",
      entityType: "employee",
      entityId: "1"
    });
  });
});
