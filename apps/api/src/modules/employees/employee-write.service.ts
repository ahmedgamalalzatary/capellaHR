import type { EmployeeCreateInput, EmployeeUpdateInput } from "@capella/shared";
import type { createAuditLogService } from "../audit-logs/service";
import { createPasswordHash } from "../auth/service";
import {
  createBranchNotAssignableError,
  createEmployeeConflictError,
  createEmployeeNotFoundError,
  createMissingEmployeeFilesError
} from "./employee-errors";
import { toEmployeeResponse } from "./employee-mappers";
import type { EmployeeFileInput, EmployeeFileStorage, EmployeeFileType } from "./file-storage";
import type { EmployeeRepository } from "./service";

export function createEmployeeWriteService(
  repository: EmployeeRepository,
  fileStorage: EmployeeFileStorage,
  auditLogService?: ReturnType<typeof createAuditLogService>
) {
  return {
    async createEmployee(input: EmployeeCreateInput, files: EmployeeFileInput[], createdByAdminId: number) {
      const missingFileTypes = getMissingEmployeeFileTypes(files);

      if (missingFileTypes.length > 0) {
        return createMissingEmployeeFilesError(missingFileTypes);
      }

      const branchSetupStatus = await repository.findBranchSetupStatus(input.branchId);

      if (branchSetupStatus !== "completed") {
        return createBranchNotAssignableError();
      }

      const employee = await repository.createEmployee({
        fullName: input.fullName,
        passwordHash: createPasswordHash(input.password),
        primaryPhone: input.primaryPhone,
        whatsappPhone: input.whatsappPhone,
        email: input.email,
        branchId: input.branchId,
        age: input.age,
        address: input.address,
        currentMonthlySalary: input.currentMonthlySalary,
        createdByAdminId
      });

      if ("error" in employee) {
        return createEmployeeConflictError(employee.error.field);
      }

      const storedFiles = await Promise.all(files.map((file) => fileStorage.saveEmployeeFile(employee.id, file)));

      await repository.insertEmployeeFiles(employee.id, storedFiles.map((file, index) => ({
        fileType: files[index]!.fileType,
        storagePath: file.storagePath,
        mimeType: file.mimeType,
        fileSizeBytes: file.fileSizeBytes
      })));

      const response = toEmployeeResponse(employee);

      await auditLogService?.recordAuditLog({
        adminId: createdByAdminId,
        actionType: "create",
        entityType: "employee",
        entityId: String(employee.id),
        entityDisplayName: employee.fullName,
        before: null,
        after: response as unknown as Record<string, unknown>
      });

      return response;
    },

    async updateEmployee(employeeId: number, input: EmployeeUpdateInput, updatedByAdminId: number) {
      const existing = await repository.findEmployeeById(employeeId);

      if (!existing) {
        return createEmployeeNotFoundError();
      }

      if (typeof input.branchId === "number") {
        const branchSetupStatus = await repository.findBranchSetupStatus(input.branchId);

        if (branchSetupStatus !== "completed") {
          return createBranchNotAssignableError();
        }
      }

      const employee = await repository.updateEmployee(employeeId, {
        fullName: input.fullName,
        passwordHash: input.password ? createPasswordHash(input.password) : undefined,
        primaryPhone: input.primaryPhone,
        whatsappPhone: input.whatsappPhone,
        email: input.email,
        branchId: input.branchId,
        age: input.age,
        address: input.address,
        currentMonthlySalary: input.currentMonthlySalary
      }, updatedByAdminId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      if ("error" in employee) {
        return createEmployeeConflictError(employee.error.field);
      }

      const response = toEmployeeResponse(employee);

      await auditLogService?.recordAuditLog({
        adminId: updatedByAdminId,
        actionType: "update",
        entityType: "employee",
        entityId: String(employee.id),
        entityDisplayName: employee.fullName,
        before: toEmployeeResponse(existing) as unknown as Record<string, unknown>,
        after: response as unknown as Record<string, unknown>
      });

      return response;
    },

    async deleteEmployee(employeeId: number, deletedByAdminId?: number) {
      const existing = await repository.findEmployeeById(employeeId);

      if (!existing) {
        return createEmployeeNotFoundError();
      }

      const deleted = await repository.softDeleteEmployee(employeeId);

      if (!deleted) {
        return createEmployeeNotFoundError();
      }

      const after = await repository.findEmployeeById(employeeId);

      await auditLogService?.recordAuditLog({
        adminId: deletedByAdminId ?? 0,
        actionType: "soft_delete",
        entityType: "employee",
        entityId: String(existing.id),
        entityDisplayName: existing.fullName,
        before: toEmployeeResponse(existing) as unknown as Record<string, unknown>,
        after: after ? toEmployeeResponse(after) as unknown as Record<string, unknown> : null
      });

      return {
        success: true
      } as const;
    }
  };
}

function getMissingEmployeeFileTypes(files: EmployeeFileInput[]): EmployeeFileType[] {
  const requiredFileTypes: EmployeeFileType[] = ["personal_photo", "id_front", "id_back"];
  const providedTypes = new Set(files.map((file) => file.fileType));

  return requiredFileTypes.filter((fileType) => !providedTypes.has(fileType));
}
