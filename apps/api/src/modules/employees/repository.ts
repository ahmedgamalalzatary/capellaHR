import type { EmployeeListFilterInput } from "@capella/shared";
import type { MySql2Database } from "drizzle-orm/mysql2";
import * as readRepo from "./employee-read.repository";
import * as assignmentRepo from "./employee-branch-assignment.repository";
import * as writeRepo from "./employee-write.repository";
import * as fileRepo from "./employee-file.repository";

export type { EmployeeConflictField, EmployeeConflictResult } from "./employee-conflict-mapper";
export type { EmployeeFileRecord, EmployeeRecord } from "./employee-mappers";

type DatabaseSchema = typeof import("../../db/schema");

type CreateDrizzleEmployeeRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

export function createDrizzleEmployeeRepository(options: CreateDrizzleEmployeeRepositoryOptions) {
  const { db } = options;

  return {
    findBranchSetupStatus: (branchId: number) => readRepo.findBranchSetupStatus(db, branchId),
    listEmployees: (filters: EmployeeListFilterInput) => readRepo.listEmployees(db, filters),
    findEmployeeById: (employeeId: number) => readRepo.findEmployeeById(db, employeeId),
    createEmployee: (input: writeRepo.CreateEmployeeInput) => writeRepo.createEmployee(db, input),
    updateEmployee: (employeeId: number, input: writeRepo.UpdateEmployeeInput, updatedByAdminId: number) =>
      writeRepo.updateEmployee(db, employeeId, input, updatedByAdminId),
    softDeleteEmployee: (employeeId: number) => writeRepo.softDeleteEmployee(db, employeeId),
    insertEmployeeFiles: (employeeId: number, files: Parameters<typeof fileRepo.insertEmployeeFiles>[2]) =>
      fileRepo.insertEmployeeFiles(db, employeeId, files),
    listEmployeeFiles: (employeeId: number) => fileRepo.listEmployeeFiles(db, employeeId),
    findEmployeeFileById: (employeeId: number, fileId: number) =>
      fileRepo.findEmployeeFileById(db, employeeId, fileId),
    replaceEmployeeFile: (
      employeeId: number,
      fileType: Parameters<typeof fileRepo.replaceEmployeeFile>[2],
      file: Parameters<typeof fileRepo.replaceEmployeeFile>[3]
    ) => fileRepo.replaceEmployeeFile(db, employeeId, fileType, file),
    listEmployeeBranchAssignments: (employeeId: number) =>
      assignmentRepo.listEmployeeBranchAssignments(db, employeeId),
    findOpenAttendanceSession: (employeeId: number) =>
      assignmentRepo.findOpenAttendanceSession(db, employeeId),
    createBranchAssignment: (input: Parameters<typeof assignmentRepo.createBranchAssignment>[1]) =>
      assignmentRepo.createBranchAssignment(db, input),
    applyPendingBranchAssignment: (employeeId: number, occurredAtUtc: Date) =>
      assignmentRepo.applyPendingBranchAssignment(db, employeeId, occurredAtUtc)
  };
}
