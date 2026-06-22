import type {
  PermissionAbsenceCreateInput,
  PermissionAbsenceListFilterInput,
  PermissionAbsenceUpdateInput
} from "@capella/shared";
import type { PermissionAbsenceRecord } from "./repository";
export type { PermissionAbsenceRecord } from "./repository";

type PermissionAbsenceErrorResult = {
  error: {
    code:
      | "EMPLOYEE_NOT_FOUND"
      | "PERMISSION_ABSENCE_NOT_FOUND"
      | "PERMISSION_ABSENCE_ATTENDANCE_CONFLICT"
      | "MONTH_LOCKED";
    message: string;
    details: Record<string, unknown>;
  };
};

export type PermissionAbsenceRepository = {
  findEmployeeById(employeeId: number): Promise<{ id: number } | null>;
  listAbsences(employeeId: number, monthKey?: string): Promise<PermissionAbsenceRecord[]>;
  findAbsenceById(absenceId: number): Promise<PermissionAbsenceRecord | null>;
  hasAttendanceOnDate(employeeId: number, absenceDate: string): Promise<boolean>;
  isMonthLocked(monthKey: string): Promise<boolean>;
  createAbsence(input: {
    employeeId: number;
    absenceDate: string;
    createdByAdminId: number;
  }): Promise<PermissionAbsenceRecord>;
  updateAbsence(absenceId: number, input: {
    absenceDate: string;
    updatedByAdminId: number;
  }): Promise<PermissionAbsenceRecord | null>;
};

type CreatePermissionAbsenceServiceOptions = {
  repository: PermissionAbsenceRepository;
};

export function createPermissionAbsenceService(options: CreatePermissionAbsenceServiceOptions) {
  return {
    async listAbsences(employeeId: number, filters: PermissionAbsenceListFilterInput) {
      const employee = await options.repository.findEmployeeById(employeeId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      return options.repository.listAbsences(employee.id, filters.monthKey);
    },

    async createAbsence(
      employeeId: number,
      input: PermissionAbsenceCreateInput,
      createdByAdminId: number
    ) {
      const employee = await options.repository.findEmployeeById(employeeId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      const validation = await validatePermissionAbsenceMutation(
        options.repository,
        employee.id,
        input.absenceDate
      );

      if (validation) {
        return validation;
      }

      return options.repository.createAbsence({
        employeeId: employee.id,
        absenceDate: input.absenceDate,
        createdByAdminId
      });
    },

    async updateAbsence(
      absenceId: number,
      input: PermissionAbsenceUpdateInput,
      updatedByAdminId: number
    ) {
      const existing = await options.repository.findAbsenceById(absenceId);

      if (!existing) {
        return {
          error: {
            code: "PERMISSION_ABSENCE_NOT_FOUND",
            message: "Permission absence not found",
            details: {}
          }
        } satisfies PermissionAbsenceErrorResult;
      }

      const validation = await validatePermissionAbsenceMutation(
        options.repository,
        existing.employeeId,
        input.absenceDate
      );

      if (validation) {
        return validation;
      }

      const absence = await options.repository.updateAbsence(absenceId, {
        absenceDate: input.absenceDate,
        updatedByAdminId
      });

      return absence ?? {
        error: {
          code: "PERMISSION_ABSENCE_NOT_FOUND",
          message: "Permission absence not found",
          details: {}
        }
      } satisfies PermissionAbsenceErrorResult;
    }
  };
}

async function validatePermissionAbsenceMutation(
  repository: PermissionAbsenceRepository,
  employeeId: number,
  absenceDate: string
) {
  if (await repository.isMonthLocked(absenceDate.slice(0, 7))) {
    return {
      error: {
        code: "MONTH_LOCKED",
        message: "The month is locked",
        details: {}
      }
    } satisfies PermissionAbsenceErrorResult;
  }

  if (await repository.hasAttendanceOnDate(employeeId, absenceDate)) {
    return {
      error: {
        code: "PERMISSION_ABSENCE_ATTENDANCE_CONFLICT",
        message: "Permission absence conflicts with existing attendance",
        details: {}
      }
    } satisfies PermissionAbsenceErrorResult;
  }

  return null;
}

function createEmployeeNotFoundError(): PermissionAbsenceErrorResult {
  return {
    error: {
      code: "EMPLOYEE_NOT_FOUND",
      message: "Employee not found",
      details: {}
    }
  };
}
