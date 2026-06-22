import type { EmployeeFileType } from "./file-storage";

export type EmployeeErrorResult = {
  error: {
    code: "BRANCH_NOT_ASSIGNABLE" | "EMPLOYEE_NOT_FOUND" | "EMPLOYEE_CONFLICT" | "MISSING_EMPLOYEE_FILES" | "EMPLOYEE_FILE_NOT_FOUND";
    message: string;
    details: Record<string, unknown>;
  };
};

export function createBranchNotAssignableError(): EmployeeErrorResult {
  return {
    error: {
      code: "BRANCH_NOT_ASSIGNABLE",
      message: "Employees can only be assigned to completed branches",
      details: {}
    }
  };
}

export function createEmployeeNotFoundError(): EmployeeErrorResult {
  return {
    error: {
      code: "EMPLOYEE_NOT_FOUND",
      message: "Employee not found",
      details: {}
    }
  };
}

export function createEmployeeConflictError(field: "primary_phone" | "whatsapp_phone" | "email"): EmployeeErrorResult {
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

export function createMissingEmployeeFilesError(missingFileTypes: EmployeeFileType[]): EmployeeErrorResult {
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

export function createEmployeeFileNotFoundError(): EmployeeErrorResult {
  return {
    error: {
      code: "EMPLOYEE_FILE_NOT_FOUND",
      message: "Employee file not found",
      details: {}
    }
  };
}
