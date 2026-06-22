import type { employeeFiles, employees } from "../../db";

export type EmployeeRecord = {
  id: number;
  fullName: string;
  passwordHash: string;
  primaryPhone: string;
  whatsappPhone: string;
  email: string | null;
  branchId: number | null;
  age: number;
  address: string;
  currentMonthlySalary: string;
  softDeletedAt: Date | null;
};

export type EmployeeFileRecord = {
  id: number;
  employeeId: number;
  fileType: "personal_photo" | "id_front" | "id_back";
  storagePath: string;
  mimeType: string;
  fileSizeBytes: number;
  replacedAt: Date | null;
};

export type EmployeeResponse = Omit<EmployeeRecord, "passwordHash">;
export type EmployeeFileResponse = Omit<EmployeeFileRecord, "employeeId" | "storagePath">;

export function mapEmployeeRecord(row: typeof employees.$inferSelect): EmployeeRecord {
  return {
    id: row.id,
    fullName: row.fullName,
    passwordHash: row.passwordHash,
    primaryPhone: row.primaryPhone,
    whatsappPhone: row.whatsappPhone,
    email: row.email ?? null,
    branchId: row.branchId ?? null,
    age: row.age,
    address: row.address,
    currentMonthlySalary: String(row.currentMonthlySalary),
    softDeletedAt: row.softDeletedAt ?? null
  };
}

export function mapEmployeeFileRecord(row: typeof employeeFiles.$inferSelect): EmployeeFileRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    fileType: row.fileType,
    storagePath: row.storagePath,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    replacedAt: row.replacedAt ?? null
  };
}

export function toEmployeeResponse(employee: EmployeeRecord): EmployeeResponse {
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

export function toEmployeeFileResponse(file: EmployeeFileRecord): EmployeeFileResponse {
  return {
    id: file.id,
    fileType: file.fileType,
    mimeType: file.mimeType,
    fileSizeBytes: file.fileSizeBytes,
    replacedAt: file.replacedAt
  };
}
