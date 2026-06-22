import type { EmployeeCreateInput } from "@capella/shared";
import { createPasswordHash } from "../auth/service";
import type { EmployeeRecord } from "./repository";

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
  }): Promise<EmployeeRecord>;
};

type CreateEmployeeServiceOptions = {
  repository: EmployeeRepository;
};

export function createEmployeeService(options: CreateEmployeeServiceOptions) {
  return {
    async createEmployee(input: EmployeeCreateInput, createdByAdminId: number) {
      const branchSetupStatus = await options.repository.findBranchSetupStatus(input.branchId);

      if (branchSetupStatus !== "completed") {
        return {
          error: {
            code: "BRANCH_NOT_ASSIGNABLE",
            message: "Employees can only be assigned to completed branches",
            details: {}
          }
        } as const;
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
  };
}
