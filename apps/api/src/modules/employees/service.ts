import type { EmployeeCreateInput, EmployeeListFilterInput, EmployeeUpdateInput } from "@capella/shared";
import { createPasswordHash } from "../auth/service";
import type { EmployeeConflictResult, EmployeeRecord } from "./repository";

type EmployeeResponse = Omit<EmployeeRecord, "passwordHash">;
type EmployeeErrorResult = {
  error: {
    code: "BRANCH_NOT_ASSIGNABLE" | "EMPLOYEE_NOT_FOUND" | "EMPLOYEE_CONFLICT";
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
  softDeleteEmployee(employeeId: number): Promise<boolean>;
};

type CreateEmployeeServiceOptions = {
  repository: EmployeeRepository;
};

export function createEmployeeService(options: CreateEmployeeServiceOptions) {
  return {
    async createEmployee(input: EmployeeCreateInput, createdByAdminId: number) {
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
