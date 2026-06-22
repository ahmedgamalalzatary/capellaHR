import type { EmployeeCreateInput, EmployeeListFilterInput, EmployeeUpdateInput } from "@capella/shared";
import { createPasswordHash } from "../auth/service";
import type { EmployeeConflictResult, EmployeeFileRecord, EmployeeRecord } from "./repository";
import type { EmployeeFileInput, EmployeeFileStorage, EmployeeFileType } from "./file-storage";

type EmployeeResponse = Omit<EmployeeRecord, "passwordHash">;
type EmployeeFileResponse = Omit<EmployeeFileRecord, "employeeId" | "storagePath">;
type EmployeeErrorResult = {
  error: {
    code: "BRANCH_NOT_ASSIGNABLE" | "EMPLOYEE_NOT_FOUND" | "EMPLOYEE_CONFLICT" | "MISSING_EMPLOYEE_FILES" | "EMPLOYEE_FILE_NOT_FOUND";
    message: string;
    details: Record<string, unknown>;
  };
};

export type EmployeeRepository = {
  findBranchSetupStatus(branchId: number): Promise<"completed" | "setup_pending" | null>;
  createEmployee(input: {
    fullName: string;
    passwordHash: string;
    primaryPhone: string;
    whatsappPhone: string;
    email?: string;
    branchId: number;
    age: number;
    address: string;
    currentMonthlySalary: string;
    createdByAdminId: number;
  }): Promise<EmployeeRecord | EmployeeConflictResult>;
  listEmployees(filters: EmployeeListFilterInput): Promise<EmployeeRecord[]>;
  findEmployeeById(employeeId: number): Promise<EmployeeRecord | null>;
  updateEmployee(employeeId: number, input: {
    fullName?: string;
    passwordHash?: string;
    primaryPhone?: string;
    whatsappPhone?: string;
    email?: string;
    branchId?: number;
    age?: number;
    address?: string;
    currentMonthlySalary?: string;
  }, updatedByAdminId: number): Promise<EmployeeRecord | EmployeeConflictResult | null>;
  insertEmployeeFiles(employeeId: number, files: Array<{
    fileType: EmployeeFileType;
    storagePath: string;
    mimeType: string;
    fileSizeBytes: number;
  }>): Promise<EmployeeFileRecord[]>;
  listEmployeeFiles(employeeId: number): Promise<EmployeeFileRecord[]>;
  findEmployeeFileById(employeeId: number, fileId: number): Promise<EmployeeFileRecord | null>;
  replaceEmployeeFile(employeeId: number, fileType: EmployeeFileType, file: {
    storagePath: string;
    mimeType: string;
    fileSizeBytes: number;
  }): Promise<EmployeeFileRecord | null>;
  softDeleteEmployee(employeeId: number): Promise<boolean>;
};

type CreateEmployeeServiceOptions = {
  repository: EmployeeRepository;
  fileStorage: EmployeeFileStorage;
};

export function createEmployeeService(options: CreateEmployeeServiceOptions) {
  return {
    async createEmployee(input: EmployeeCreateInput, files: EmployeeFileInput[], createdByAdminId: number) {
      const missingFileTypes = getMissingEmployeeFileTypes(files);

      if (missingFileTypes.length > 0) {
        return createMissingEmployeeFilesError(missingFileTypes);
      }

      const branchSetupStatus = await options.repository.findBranchSetupStatus(input.branchId);

      if (branchSetupStatus !== "completed") {
        return createBranchNotAssignableError();
      }

      const employee = await options.repository.createEmployee({
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

      const storedFiles = await Promise.all(files.map((file) => options.fileStorage.saveEmployeeFile(employee.id, file)));

      await options.repository.insertEmployeeFiles(employee.id, storedFiles.map((file, index) => ({
        fileType: files[index]!.fileType,
        storagePath: file.storagePath,
        mimeType: file.mimeType,
        fileSizeBytes: file.fileSizeBytes
      })));

      return toEmployeeResponse(employee);
    },

    async listEmployees(filters: EmployeeListFilterInput) {
      const employees = await options.repository.listEmployees(filters);

      return employees.map(toEmployeeResponse);
    },

    async getEmployeeById(employeeId: number) {
      const employee = await options.repository.findEmployeeById(employeeId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      return toEmployeeResponse(employee);
    },

    async updateEmployee(employeeId: number, input: EmployeeUpdateInput, updatedByAdminId: number) {
      if (typeof input.branchId === "number") {
        const branchSetupStatus = await options.repository.findBranchSetupStatus(input.branchId);

        if (branchSetupStatus !== "completed") {
          return createBranchNotAssignableError();
        }
      }

      const employee = await options.repository.updateEmployee(employeeId, {
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

      return toEmployeeResponse(employee);
    },

    async deleteEmployee(employeeId: number) {
      const deleted = await options.repository.softDeleteEmployee(employeeId);

      if (!deleted) {
        return createEmployeeNotFoundError();
      }

      return {
        success: true
      } as const;
    },

    async listEmployeeFiles(employeeId: number) {
      const files = await options.repository.listEmployeeFiles(employeeId);

      return {
        files: files.map(toEmployeeFileResponse)
      };
    },

    async getEmployeeFile(employeeId: number, fileId: number) {
      const file = await options.repository.findEmployeeFileById(employeeId, fileId);

      if (!file) {
        return createEmployeeFileNotFoundError();
      }

      return {
        file: toEmployeeFileResponse(file),
        content: await options.fileStorage.readEmployeeFile(file.storagePath)
      };
    },

    async replaceEmployeeFile(
      employeeId: number,
      fileType: EmployeeFileType,
      file: EmployeeFileInput,
      updatedByAdminId: number
    ) {
      void updatedByAdminId;

      const storedFile = await options.fileStorage.saveEmployeeFile(employeeId, file);
      const replacedFile = await options.repository.replaceEmployeeFile(employeeId, fileType, storedFile);

      if (!replacedFile) {
        return createEmployeeFileNotFoundError();
      }

      return {
        file: toEmployeeFileResponse(replacedFile)
      };
    }
  };
}

function toEmployeeResponse(employee: EmployeeRecord): EmployeeResponse {
  return {
    id: employee.id,
    fullName: employee.fullName,
    primaryPhone: employee.primaryPhone,
    whatsappPhone: employee.whatsappPhone,
    email: employee.email,
    branchId: employee.branchId,
    age: employee.age,
    address: employee.address,
    currentMonthlySalary: employee.currentMonthlySalary,
    softDeletedAt: employee.softDeletedAt
  };
}

function toEmployeeFileResponse(file: EmployeeFileRecord): EmployeeFileResponse {
  return {
    id: file.id,
    fileType: file.fileType,
    mimeType: file.mimeType,
    fileSizeBytes: file.fileSizeBytes,
    replacedAt: file.replacedAt
  };
}

function createBranchNotAssignableError(): EmployeeErrorResult {
  return {
    error: {
      code: "BRANCH_NOT_ASSIGNABLE",
      message: "Employees can only be assigned to completed branches",
      details: {}
    }
  };
}

function createEmployeeNotFoundError(): EmployeeErrorResult {
  return {
    error: {
      code: "EMPLOYEE_NOT_FOUND",
      message: "Employee not found",
      details: {}
    }
  };
}

function createEmployeeConflictError(field: "primary_phone" | "whatsapp_phone" | "email"): EmployeeErrorResult {
  return {
    error: {
      code: "EMPLOYEE_CONFLICT",
      message: `Employee ${field} must be unique`,
      details: {
        field
      }
    }
  };
}

function createMissingEmployeeFilesError(missingFileTypes: EmployeeFileType[]): EmployeeErrorResult {
  return {
    error: {
      code: "MISSING_EMPLOYEE_FILES",
      message: "Employee files are required",
      details: {
        missingFileTypes
      }
    }
  };
}

function createEmployeeFileNotFoundError(): EmployeeErrorResult {
  return {
    error: {
      code: "EMPLOYEE_FILE_NOT_FOUND",
      message: "Employee file not found",
      details: {}
    }
  };
}

function getMissingEmployeeFileTypes(files: EmployeeFileInput[]): EmployeeFileType[] {
  const requiredFileTypes: EmployeeFileType[] = ["personal_photo", "id_front", "id_back"];
  const providedTypes = new Set(files.map((file) => file.fileType));

  return requiredFileTypes.filter((fileType) => !providedTypes.has(fileType));
}

export type { EmployeeFileInput, EmployeeFileStorage, EmployeeFileType };
