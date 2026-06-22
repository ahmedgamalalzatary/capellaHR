import type { EmployeeCreateInput, EmployeeListFilterInput } from "@capella/shared";
import type { EmployeeRepository } from "../../../../src/modules/employees/service";
import type { EmployeeConflictField, EmployeeConflictResult, EmployeeFileRecord, EmployeeRecord } from "../../../../src/modules/employees/repository";
import type {
  EmployeeFileInput,
  EmployeeFileType,
  EmployeeFileStorage
} from "../../../../src/modules/employees/service";

export class InMemoryEmployeeRepository implements EmployeeRepository {
  branchSetupStatus: "completed" | "setup_pending" | null = "completed";
  createdEmployee: unknown = null;
  employees: EmployeeRecord[] = [
    {
      id: 1,
      fullName: "Mina Adel",
      passwordHash: "plain:secret123",
      primaryPhone: "01012345678",
      whatsappPhone: "01012345679",
      email: "mina@capella.eg",
      branchId: 1,
      age: 28,
      address: "Cairo",
      currentMonthlySalary: "10000",
      softDeletedAt: null
    }
  ];
  nextCreateError: "primary_phone" | "whatsapp_phone" | "email" | null = null;
  nextUpdateError: "primary_phone" | "whatsapp_phone" | "email" | null = null;
  employeeFiles: EmployeeFileRecord[] = [];
  branchAssignments: Array<{
    id: number;
    employeeId: number;
    branchId: number;
    effectiveFrom: string;
    effectiveTo: null | string;
    assignedByAdminId: number;
  }> = [
    {
      id: 1,
      employeeId: 1,
      branchId: 1,
      effectiveFrom: "2026-06-01T00:00:00.000Z",
      effectiveTo: null,
      assignedByAdminId: 1
    }
  ];
  openSessionEmployeeIds = new Set<number>();

  async findBranchSetupStatus() {
    return this.branchSetupStatus;
  }

  async createEmployee(input: {
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
    }) {
    this.createdEmployee = input;

    if (this.nextCreateError) {
      return createConflict(this.nextCreateError);
    }

    return {
      id: 1,
      fullName: input.fullName,
      passwordHash: input.passwordHash,
      primaryPhone: input.primaryPhone,
      whatsappPhone: input.whatsappPhone,
      email: input.email ?? null,
      branchId: input.branchId,
      age: input.age,
      address: input.address,
      currentMonthlySalary: input.currentMonthlySalary,
      softDeletedAt: null
    };
  }

  async listEmployees(filters: EmployeeListFilterInput) {
    return this.employees.filter((employee) => {
      if (filters.search && !employee.fullName.toLowerCase().includes(filters.search.toLowerCase())) {
        return false;
      }

      if (typeof filters.branchId === "number" && employee.branchId !== filters.branchId) {
        return false;
      }

      if (filters.status === "active" && employee.softDeletedAt) {
        return false;
      }

      if (filters.status === "soft_deleted" && !employee.softDeletedAt) {
        return false;
      }

      return true;
    });
  }

  async findEmployeeById(employeeId: number) {
    return this.employees.find((employee) => employee.id === employeeId) ?? null;
  }

  async updateEmployee(employeeId: number, input: {
    fullName?: string;
    passwordHash?: string;
    primaryPhone?: string;
    whatsappPhone?: string;
    email?: string;
    branchId?: number;
    age?: number;
    address?: string;
    currentMonthlySalary?: string;
  }, updatedByAdminId: number) {
    void updatedByAdminId;

    const existing = this.employees.find((employee) => employee.id === employeeId);

    if (!existing) {
      return null;
    }

    if (this.nextUpdateError) {
      return createConflict(this.nextUpdateError);
    }

    const updates = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined)
    );

    Object.assign(existing, updates);
    return existing;
  }

  async softDeleteEmployee(employeeId: number) {
    const existing = this.employees.find((employee) => employee.id === employeeId);

    if (!existing) {
      return false;
    }

    existing.softDeletedAt = new Date();
    return true;
  }

  async listEmployeeBranchAssignments(employeeId: number) {
    return this.branchAssignments.filter((assignment) => assignment.employeeId === employeeId);
  }

  async findOpenAttendanceSession(employeeId: number) {
    return this.openSessionEmployeeIds.has(employeeId) ? { id: 1 } : null;
  }

  async createBranchAssignment(input: {
    employeeId: number;
    branchId: number;
    effectiveFrom: Date;
    assignedByAdminId: number;
    applyImmediately: boolean;
  }) {
    const assignment = {
      id: this.branchAssignments.length + 1,
      employeeId: input.employeeId,
      branchId: input.branchId,
      effectiveFrom: input.effectiveFrom.toISOString(),
      effectiveTo: null,
      assignedByAdminId: input.assignedByAdminId
    };

    this.branchAssignments.push(assignment);

    if (input.applyImmediately) {
      const employee = this.employees.find((item) => item.id === input.employeeId);

      if (employee) {
        employee.branchId = input.branchId;
      }
    }

    return assignment;
  }

  async applyPendingBranchAssignment(employeeId: number, occurredAtUtc: Date) {
    const dueAssignment = this.branchAssignments
      .filter((assignment) => (
        assignment.employeeId === employeeId &&
        assignment.effectiveTo === null &&
        new Date(assignment.effectiveFrom).getTime() <= occurredAtUtc.getTime()
      ))
      .sort((left, right) => new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime())[0];

    if (!dueAssignment) {
      return false;
    }

    const employee = this.employees.find((item) => item.id === employeeId);

    if (!employee) {
      return false;
    }

    employee.branchId = dueAssignment.branchId;
    return true;
  }

  async insertEmployeeFiles(
    employeeId: number,
    files: Array<{
      fileType: EmployeeFileType;
      storagePath: string;
      mimeType: string;
      fileSizeBytes: number;
    }>
  ) {
    const nextFiles = files.map((file, index) => ({
      id: this.employeeFiles.length + index + 1,
      employeeId,
      fileType: file.fileType,
      storagePath: file.storagePath,
      mimeType: file.mimeType,
      fileSizeBytes: file.fileSizeBytes,
      replacedAt: null
    }));

    this.employeeFiles.push(...nextFiles);

    return nextFiles;
  }

  async listEmployeeFiles(employeeId: number) {
    return this.employeeFiles.filter((file) => file.employeeId === employeeId && file.replacedAt === null);
  }

  async findEmployeeFileById(employeeId: number, fileId: number) {
    return this.employeeFiles.find((file) => file.employeeId === employeeId && file.id === fileId) ?? null;
  }

  async replaceEmployeeFile(
    employeeId: number,
    fileType: EmployeeFileType,
    file: {
      storagePath: string;
      mimeType: string;
      fileSizeBytes: number;
    }
  ) {
    const activeFile = this.employeeFiles.find((entry) => (
      entry.employeeId === employeeId &&
      entry.fileType === fileType &&
      entry.replacedAt === null
    ));

    if (!activeFile) {
      return null;
    }

    activeFile.replacedAt = new Date("2026-06-22T12:00:00.000Z");

    const nextFile = {
      id: this.employeeFiles.length + 1,
      employeeId,
      fileType,
      storagePath: file.storagePath,
      mimeType: file.mimeType,
      fileSizeBytes: file.fileSizeBytes,
      replacedAt: null
    };

    this.employeeFiles.push(nextFile);

    return nextFile;
  }
}

export function createConflict(field: EmployeeConflictField): EmployeeConflictResult {
  return {
    error: {
      code: "EMPLOYEE_CONFLICT",
      field
    }
  };
}

export function createInput(): EmployeeCreateInput {
  return {
    fullName: "Mina Adel",
    password: "secret123",
    primaryPhone: "01012345678",
    whatsappPhone: "01012345679",
    email: "mina@capella.eg",
    branchId: 1,
    age: 28,
    address: "Cairo",
    currentMonthlySalary: "10000"
  };
}

export class InMemoryEmployeeFileStorage implements EmployeeFileStorage {
  savedFiles: Array<{ employeeId: number; fileType: EmployeeFileType; mimeType: string }> = [];
  fileContents = new Map<string, Buffer>();

  async saveEmployeeFile(employeeId: number, file: EmployeeFileInput) {
    this.savedFiles.push({
      employeeId,
      fileType: file.fileType,
      mimeType: file.mimeType
    });

    const storagePath = `employees/${employeeId}/${file.fileType}/${this.savedFiles.length}.jpg`;
    this.fileContents.set(storagePath, file.buffer);

    return {
      storagePath,
      mimeType: file.mimeType,
      fileSizeBytes: file.sizeBytes
    };
  }

  async readEmployeeFile(storagePath: string) {
    const content = this.fileContents.get(storagePath);

    if (!content) {
      throw new Error("missing test file");
    }

    return content;
  }
}

export function createRequiredFiles(): [EmployeeFileInput, EmployeeFileInput, EmployeeFileInput] {
  return [
    createUploadedFile("personal_photo"),
    createUploadedFile("id_front"),
    createUploadedFile("id_back")
  ];
}

export function createUploadedFile(fileType: EmployeeFileType): EmployeeFileInput {
  return {
    fileType,
    originalName: `${fileType}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 12,
    buffer: Buffer.from("hello-world!")
  };
}
