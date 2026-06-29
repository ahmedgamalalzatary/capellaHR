import type { Pagination } from "@/features/branches/branches.types";

/** Whether an employee is active or has been soft-deleted. */
export type EmployeeStatus = "active" | "soft_deleted";

/** The three image files every employee record carries. */
export type EmployeeFileType = "personal_photo" | "id_front" | "id_back";

/**
 * An employee as returned by the API. Mirrors apps/api `toEmployeeResponse`
 * (the password hash is never sent to clients). `softDeletedAt` is an ISO
 * string when the employee is soft-deleted, otherwise `null`.
 */
export type Employee = {
  id: number;
  fullName: string;
  primaryPhone: string;
  whatsappPhone: string;
  email: string | null;
  branchId: number | null;
  age: number;
  address: string;
  currentMonthlySalary: string;
  softDeletedAt: string | null;
};

/** One stored employee file's metadata. Mirrors `toEmployeeFileResponse`. */
export type EmployeeFile = {
  id: number;
  fileType: EmployeeFileType;
  mimeType: string;
  fileSizeBytes: number;
  replacedAt: string | null;
};

/** A historical branch assignment for an employee. */
export type EmployeeBranchAssignment = {
  id: number;
  employeeId: number;
  branchId: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  assignedByAdminId: number;
};

export type EmployeeDeviceState = {
  employeeId: number;
  activeDevice: {
    id: number;
    deviceLabel: string | null;
    browserFingerprint: string;
    registeredAt: string;
  } | null;
  pendingSetup: {
    id: number;
    deviceToken: string;
    deviceLabel: string | null;
    expiresAt: string;
  } | null;
};

export type EmployeeListResponse = {
  employees: {
    items: Employee[];
    pagination: Pagination;
  };
};

export type EmployeeResponse = {
  employee: Employee;
};

export type EmployeeFileListResponse = {
  files: EmployeeFile[];
};

export type EmployeeFileResponse = {
  file: EmployeeFile;
};

export type EmployeeBranchAssignmentListResponse = {
  assignments: EmployeeBranchAssignment[];
};

export type EmployeeBranchAssignmentResponse = {
  assignment: EmployeeBranchAssignment;
};

export type EmployeeDeviceResponse = {
  employeeDevice: EmployeeDeviceState;
};

export type EmployeeDeviceSetupLinkInput = {
  deviceLabel?: string;
};

export type EmployeeDeviceSetupCompletionInput = {
  deviceLabel?: string;
  browserFingerprint: string;
};

export type EmployeeDeviceRevokeResponse = {
  success: boolean;
};

/** Filters accepted by the employee list endpoint (`GET /employees`). */
export type EmployeeListFilters = {
  page?: number;
  pageSize?: number;
  search?: string;
  branchId?: number;
  status?: EmployeeStatus;
};

/**
 * Payload for creating an employee (`POST /employees`, multipart). Carries the
 * text fields plus the three required image files; the api layer serializes it
 * into `FormData`.
 */
export type EmployeeCreatePayload = {
  fullName: string;
  password: string;
  primaryPhone: string;
  whatsappPhone: string;
  email?: string;
  branchId: number;
  age: number;
  currentMonthlySalary: string;
  address: string;
  personalPhoto: File;
  idFront: File;
  idBack: File;
};

/**
 * Fields the update endpoint accepts (`PATCH /employees/:id`, JSON). Every
 * field is optional; only provided fields are changed. Files are replaced
 * through the separate per-file endpoint, so they are not part of this payload.
 */
export type EmployeeUpdatePayload = {
  fullName?: string;
  password?: string;
  primaryPhone?: string;
  whatsappPhone?: string;
  email?: string;
  branchId?: number;
  age?: number;
  address?: string;
  currentMonthlySalary?: string;
};
