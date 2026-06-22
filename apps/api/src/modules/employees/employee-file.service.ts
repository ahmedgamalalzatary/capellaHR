import type { createAuditLogService } from "../audit-logs/service";
import { createEmployeeFileNotFoundError } from "./employee-errors";
import { toEmployeeFileResponse } from "./employee-mappers";
import type { EmployeeFileInput, EmployeeFileStorage, EmployeeFileType } from "./file-storage";
import type { EmployeeRepository } from "./service";

export function createEmployeeFileService(
  repository: EmployeeRepository,
  fileStorage: EmployeeFileStorage,
  auditLogService?: ReturnType<typeof createAuditLogService>
) {
  return {
    async listEmployeeFiles(employeeId: number) {
      const files = await repository.listEmployeeFiles(employeeId);

      return {
        files: files.map(toEmployeeFileResponse)
      };
    },

    async getEmployeeFile(employeeId: number, fileId: number) {
      const file = await repository.findEmployeeFileById(employeeId, fileId);

      if (!file) {
        return createEmployeeFileNotFoundError();
      }

      return {
        file: toEmployeeFileResponse(file),
        content: await fileStorage.readEmployeeFile(file.storagePath)
      };
    },

    async replaceEmployeeFile(
      employeeId: number,
      fileType: EmployeeFileType,
      file: EmployeeFileInput,
      updatedByAdminId: number
    ) {
      const employee = await repository.findEmployeeById(employeeId);
      const beforeFile = (await repository.listEmployeeFiles(employeeId)).find((entry) => entry.fileType === fileType) ?? null;

      const storedFile = await fileStorage.saveEmployeeFile(employeeId, file);
      const replacedFile = await repository.replaceEmployeeFile(employeeId, fileType, storedFile);

      if (!replacedFile) {
        return createEmployeeFileNotFoundError();
      }

      const response = {
        file: toEmployeeFileResponse(replacedFile)
      };

      await auditLogService?.recordAuditLog({
        adminId: updatedByAdminId,
        actionType: "update",
        entityType: "employee",
        entityId: String(employeeId),
        entityDisplayName: employee?.fullName,
        before: beforeFile ? {
          fileType: beforeFile.fileType,
          mimeType: beforeFile.mimeType,
          fileSizeBytes: beforeFile.fileSizeBytes
        } : null,
        after: {
          fileType: response.file.fileType,
          mimeType: response.file.mimeType,
          fileSizeBytes: response.file.fileSizeBytes
        }
      });

      return response;
    }
  };
}
