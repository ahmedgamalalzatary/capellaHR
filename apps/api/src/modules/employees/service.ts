import type { EmployeeListFilterInput } from "@capella/shared";
import type { createAuditLogService } from "../audit-logs/service";
import type { EmployeeConflictResult, EmployeeFileRecord, EmployeeRecord } from "./repository";
import type { EmployeeFileInput, EmployeeFileStorage, EmployeeFileType } from "./file-storage";
import { createEmployeeReadService } from "./employee-read.service";
import { createEmployeeBranchAssignmentService } from "./employee-branch-assignment.service";
import { createEmployeeWriteService } from "./employee-write.service";
import { createEmployeeFileService } from "./employee-file.service";
export type { EmployeeBranchAssignmentRecord } from "./employee-branch-assignment.repository";

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
  listEmployeeBranchAssignments(employeeId: number): Promise<Array<{
    id: number;
    employeeId: number;
    branchId: number;
    effectiveFrom: string;
    effectiveTo: null | string;
    assignedByAdminId: number;
  }>>;
  findOpenAttendanceSession(employeeId: number): Promise<{ id: number } | null>;
  createBranchAssignment(input: {
    employeeId: number;
    branchId: number;
    effectiveFrom: Date;
    assignedByAdminId: number;
    applyImmediately: boolean;
  }): Promise<{
    id: number;
    employeeId: number;
    branchId: number;
    effectiveFrom: string;
    effectiveTo: null | string;
    assignedByAdminId: number;
  }>;
  applyPendingBranchAssignment(employeeId: number, occurredAtUtc: Date): Promise<boolean>;
};

type CreateEmployeeServiceOptions = {
  repository: EmployeeRepository;
  fileStorage: EmployeeFileStorage;
  auditLogService?: ReturnType<typeof createAuditLogService>;
};

export function createEmployeeService(options: CreateEmployeeServiceOptions) {
  return {
    ...createEmployeeReadService(options.repository),
    ...createEmployeeBranchAssignmentService(options.repository, options.auditLogService),
    ...createEmployeeWriteService(options.repository, options.fileStorage, options.auditLogService),
    ...createEmployeeFileService(options.repository, options.fileStorage, options.auditLogService)
  };
}

export type { EmployeeFileInput, EmployeeFileStorage, EmployeeFileType };
