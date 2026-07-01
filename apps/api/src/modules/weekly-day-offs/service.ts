import type {
  WeeklyDayOffAssignmentCreateInput,
  WeeklyDayOffAssignmentListFilterInput,
  WeeklyDayOffAssignmentUpdateInput
} from "@capella/shared";
import type { createAuditLogService } from "../audit-logs/service";
import type { WeeklyDayOffAssignmentRecord } from "./repository";
export type { WeeklyDayOffAssignmentRecord } from "./repository";

type WeeklyDayOffErrorResult = {
  error: {
    code:
      | "EMPLOYEE_NOT_FOUND"
      | "WEEKLY_DAY_OFF_NOT_FOUND"
      | "WEEKLY_DAY_OFF_OVERRIDE_REASON_REQUIRED"
      | "WEEKLY_DAY_OFF_ATTENDANCE_CONFLICT"
      | "MONTH_LOCKED";
    message: string;
    details: Record<string, unknown>;
  };
};

export type WeeklyDayOffRepository = {
  findEmployeeById(employeeId: number): Promise<{ id: number } | null>;
  listAssignments(employeeId: number, weekStartDate?: string): Promise<WeeklyDayOffAssignmentRecord[]>;
  findAssignmentById(assignmentId: number): Promise<WeeklyDayOffAssignmentRecord | null>;
  hasAttendanceOnDate(employeeId: number, dayOffDate: string): Promise<boolean>;
  isMonthLocked(monthKey: string): Promise<boolean>;
  createAssignment(input: {
    employeeId: number;
    weekStartDate: string;
    dayOffDate: string;
    overrideReason?: string;
    assignedByAdminId: number;
  }): Promise<WeeklyDayOffAssignmentRecord>;
  updateAssignment(assignmentId: number, input: {
    weekStartDate: string;
    dayOffDate: string;
    overrideReason?: string | null;
  }): Promise<WeeklyDayOffAssignmentRecord | null>;
};

type CreateWeeklyDayOffServiceOptions = {
  repository: WeeklyDayOffRepository;
  auditLogService?: ReturnType<typeof createAuditLogService>;
};

export function createWeeklyDayOffService(options: CreateWeeklyDayOffServiceOptions) {
  return {
    async listAssignments(employeeId: number, filters: WeeklyDayOffAssignmentListFilterInput) {
      const employee = await options.repository.findEmployeeById(employeeId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      return options.repository.listAssignments(employee.id, filters.weekStartDate);
    },

    async createAssignment(
      employeeId: number,
      input: WeeklyDayOffAssignmentCreateInput,
      assignedByAdminId: number
    ) {
      const employee = await options.repository.findEmployeeById(employeeId);

      if (!employee) {
        return createEmployeeNotFoundError();
      }

      const validation = await validateWeeklyDayOffMutation(
        options.repository,
        employee.id,
        input.dayOffDate,
        input.overrideReason
      );

      if (validation) {
        return validation;
      }

      const assignment = await options.repository.createAssignment({
        employeeId: employee.id,
        weekStartDate: getWeekStartDate(input.dayOffDate),
        dayOffDate: input.dayOffDate,
        overrideReason: input.overrideReason,
        assignedByAdminId
      });

      await options.auditLogService?.recordAuditLog({
        adminId: assignedByAdminId,
        actionType: "create",
        entityType: "weekly_day_off",
        entityId: String(assignment.id),
        reason: input.overrideReason ?? null,
        before: null,
        after: assignment as unknown as Record<string, unknown>
      });

      return assignment;
    },

    async updateAssignment(
      assignmentId: number,
      input: WeeklyDayOffAssignmentUpdateInput,
      updatedByAdminId: number
    ) {
      const existing = await options.repository.findAssignmentById(assignmentId);

      if (!existing) {
        return {
          error: {
            code: "WEEKLY_DAY_OFF_NOT_FOUND",
            message: "Weekly day off assignment not found",
            details: {}
          }
        } satisfies WeeklyDayOffErrorResult;
      }

      const validation = await validateWeeklyDayOffMutation(
        options.repository,
        existing.employeeId,
        input.dayOffDate,
        input.overrideReason,
        assignmentId
      );

      if (validation) {
        return validation;
      }

      const assignment = await options.repository.updateAssignment(assignmentId, {
        weekStartDate: getWeekStartDate(input.dayOffDate),
        dayOffDate: input.dayOffDate,
        overrideReason: input.overrideReason
      });

      if (assignment) {
        await options.auditLogService?.recordAuditLog({
          adminId: updatedByAdminId,
          actionType: "update",
          entityType: "weekly_day_off",
          entityId: String(assignment.id),
          reason: input.overrideReason ?? null,
          before: existing as unknown as Record<string, unknown>,
          after: assignment as unknown as Record<string, unknown>
        });
      }

      return assignment ?? {
        error: {
          code: "WEEKLY_DAY_OFF_NOT_FOUND",
          message: "Weekly day off assignment not found",
          details: {}
        }
      } satisfies WeeklyDayOffErrorResult;
    }
  };
}

async function validateWeeklyDayOffMutation(
  repository: WeeklyDayOffRepository,
  employeeId: number,
  dayOffDate: string,
  overrideReason?: string | null,
  excludeAssignmentId?: number
) {
  if (await repository.isMonthLocked(dayOffDate.slice(0, 7))) {
    return {
      error: {
        code: "MONTH_LOCKED",
        message: "The month is locked",
        details: {}
      }
    } satisfies WeeklyDayOffErrorResult;
  }

  if (await repository.hasAttendanceOnDate(employeeId, dayOffDate)) {
    return {
      error: {
        code: "WEEKLY_DAY_OFF_ATTENDANCE_CONFLICT",
        message: "Day off conflicts with existing attendance",
        details: {}
      }
    } satisfies WeeklyDayOffErrorResult;
  }

  const weekStartDate = getWeekStartDate(dayOffDate);
  const existingAssignments = await repository.listAssignments(employeeId, weekStartDate);
  const remainingAssignments = excludeAssignmentId
    ? existingAssignments.filter((assignment) => assignment.id !== excludeAssignmentId)
    : existingAssignments;

  if (remainingAssignments.length > 0 && !overrideReason) {
    return {
      error: {
        code: "WEEKLY_DAY_OFF_OVERRIDE_REASON_REQUIRED",
        message: "Override reason is required for more than one weekly day off",
        details: {}
      }
    } satisfies WeeklyDayOffErrorResult;
  }

  return null;
}

function createEmployeeNotFoundError(): WeeklyDayOffErrorResult {
  return {
    error: {
      code: "EMPLOYEE_NOT_FOUND",
      message: "Employee not found",
      details: {}
    }
  };
}

function getWeekStartDate(dateText: string) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const dayOfWeek = date.getUTCDay();
  const offsetFromSaturday = (dayOfWeek + 1) % 7;
  date.setUTCDate(date.getUTCDate() - offsetFromSaturday);
  return date.toISOString().slice(0, 10);
}
