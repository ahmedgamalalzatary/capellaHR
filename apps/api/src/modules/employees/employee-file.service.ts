import { createEmployeeFileNotFoundError } from "./employee-errors";
import { toEmployeeFileResponse } from "./employee-mappers";
import type { EmployeeFileInput, EmployeeFileStorage, EmployeeFileType } from "./file-storage";
import type { EmployeeRepository } from "./service";

export function createEmployeeFileService(repository: EmployeeRepository, fileStorage: EmployeeFileStorage) {
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
      void updatedByAdminId;

      const storedFile = await fileStorage.saveEmployeeFile(employeeId, file);
      const replacedFile = await repository.replaceEmployeeFile(employeeId, fileType, storedFile);

      if (!replacedFile) {
        return createEmployeeFileNotFoundError();
      }

      return {
        file: toEmployeeFileResponse(replacedFile)
      };
    }
  };
}
