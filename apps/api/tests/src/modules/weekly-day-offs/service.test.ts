import { describe, expect, it } from "vitest";
import type { WeeklyDayOffAssignmentCreateInput } from "@capella/shared";
import { InMemoryAuditLogService } from "../audit-logs/audit-log-test.fixtures";
import { createWeeklyDayOffService } from "../../../../src/modules/weekly-day-offs/service";
import type {
  WeeklyDayOffAssignmentRecord,
  WeeklyDayOffRepository
} from "../../../../src/modules/weekly-day-offs/service";

class InMemoryWeeklyDayOffRepository implements WeeklyDayOffRepository {
  employees = new Set([1]);
  assignments: WeeklyDayOffAssignmentRecord[] = [];
  attendanceDates = new Set<string>();
  lockedMonths = new Set<string>();
  nextId = 1;

  async findEmployeeById(employeeId: number) {
    return this.employees.has(employeeId) ? { id: employeeId } : null;
  }

  async listAssignments(employeeId: number, weekStartDate?: string) {
    return this.assignments.filter((assignment) =>
      assignment.employeeId === employeeId
      && (!weekStartDate || assignment.weekStartDate === weekStartDate)
    );
  }

  async findAssignmentById(assignmentId: number) {
    return this.assignments.find((assignment) => assignment.id === assignmentId) ?? null;
  }

  async hasAttendanceOnDate(employeeId: number, dayOffDate: string) {
    return this.attendanceDates.has(`${employeeId}:${dayOffDate}`);
  }

  async isMonthLocked(monthKey: string) {
    return this.lockedMonths.has(monthKey);
  }

  async createAssignment(input: {
    employeeId: number;
    weekStartDate: string;
    dayOffDate: string;
    overrideReason?: string;
    assignedByAdminId: number;
  }) {
    const assignment: WeeklyDayOffAssignmentRecord = {
      id: this.nextId++,
      employeeId: input.employeeId,
      weekStartDate: input.weekStartDate,
      dayOffDate: input.dayOffDate,
      overrideReason: input.overrideReason ?? null,
      assignedByAdminId: input.assignedByAdminId
    };

    this.assignments.push(assignment);
    return assignment;
  }

  async updateAssignment(assignmentId: number, input: {
    weekStartDate: string;
    dayOffDate: string;
    overrideReason?: string | null;
  }) {
    const assignment = this.assignments.find((item) => item.id === assignmentId) ?? null;

    if (!assignment) {
      return null;
    }

    assignment.weekStartDate = input.weekStartDate;
    assignment.dayOffDate = input.dayOffDate;
    assignment.overrideReason = input.overrideReason ?? null;

    return assignment;
  }
}

describe("weekly day off service", () => {
  it("assigns a weekly day off using the saturday week start", async () => {
    const repository = new InMemoryWeeklyDayOffRepository();
    const auditLogService = new InMemoryAuditLogService();
    const service = createWeeklyDayOffService({ repository, auditLogService });

    const result = await service.createAssignment(1, validCreateInput("2026-06-29"), 9);

    assertAssignment(result);
    expect(result.weekStartDate).toBe("2026-06-27");
    expect(result.assignedByAdminId).toBe(9);
    expect(auditLogService.logs[0]).toMatchObject({
      actionType: "create",
      entityType: "weekly_day_off",
      entityId: "1"
    });
  });

  it("requires an override reason when assigning a second day off in the same week", async () => {
    const repository = new InMemoryWeeklyDayOffRepository();
    repository.assignments.push({
      id: 1,
      employeeId: 1,
      weekStartDate: "2026-06-27",
      dayOffDate: "2026-06-29",
      overrideReason: null,
      assignedByAdminId: 1
    });
    const service = createWeeklyDayOffService({ repository });

    const result = await service.createAssignment(1, validCreateInput("2026-07-01"), 9);

    expect(result).toEqual({
      error: {
        code: "WEEKLY_DAY_OFF_OVERRIDE_REASON_REQUIRED",
        message: "Override reason is required for more than one weekly day off",
        details: {}
      }
    });
  });

  it("allows a second day off in the same week when an override reason is provided", async () => {
    const repository = new InMemoryWeeklyDayOffRepository();
    repository.assignments.push({
      id: 1,
      employeeId: 1,
      weekStartDate: "2026-06-27",
      dayOffDate: "2026-06-29",
      overrideReason: null,
      assignedByAdminId: 1
    });
    const service = createWeeklyDayOffService({ repository });

    const result = await service.createAssignment(1, {
      dayOffDate: "2026-07-01",
      overrideReason: "Holiday coverage"
    }, 9);

    assertAssignment(result);
    expect(result.overrideReason).toBe("Holiday coverage");
  });

  it("blocks assignment when attendance already exists on that date", async () => {
    const repository = new InMemoryWeeklyDayOffRepository();
    repository.attendanceDates.add("1:2026-06-29");
    const service = createWeeklyDayOffService({ repository });

    const result = await service.createAssignment(1, validCreateInput("2026-06-29"), 9);

    expect(result).toEqual({
      error: {
        code: "WEEKLY_DAY_OFF_ATTENDANCE_CONFLICT",
        message: "Day off conflicts with existing attendance",
        details: {}
      }
    });
  });

  it("blocks assignment inside a locked month", async () => {
    const repository = new InMemoryWeeklyDayOffRepository();
    repository.lockedMonths.add("2026-06");
    const service = createWeeklyDayOffService({ repository });

    const result = await service.createAssignment(1, validCreateInput("2026-06-29"), 9);

    expect(result).toEqual({
      error: {
        code: "MONTH_LOCKED",
        message: "The month is locked",
        details: {}
      }
    });
  });

  it("updates an existing assignment and re-evaluates override rules", async () => {
    const repository = new InMemoryWeeklyDayOffRepository();
    repository.assignments.push({
      id: 1,
      employeeId: 1,
      weekStartDate: "2026-06-27",
      dayOffDate: "2026-06-29",
      overrideReason: null,
      assignedByAdminId: 1
    });
    repository.assignments.push({
      id: 2,
      employeeId: 1,
      weekStartDate: "2026-07-04",
      dayOffDate: "2026-07-04",
      overrideReason: null,
      assignedByAdminId: 1
    });
    const auditLogService = new InMemoryAuditLogService();
    const service = createWeeklyDayOffService({ repository, auditLogService });

    const result = await service.updateAssignment(2, {
      dayOffDate: "2026-07-03",
      overrideReason: "Schedule override"
    }, 9);

    assertAssignment(result);
    expect(result.weekStartDate).toBe("2026-06-27");
    expect(result.overrideReason).toBe("Schedule override");
    expect(auditLogService.logs[0]).toMatchObject({
      actionType: "update",
      entityType: "weekly_day_off",
      entityId: "2",
      reason: "Schedule override"
    });
  });
});

function validCreateInput(dayOffDate: string): WeeklyDayOffAssignmentCreateInput {
  return { dayOffDate };
}

function assertAssignment(
  value: Awaited<ReturnType<ReturnType<typeof createWeeklyDayOffService>["createAssignment"]>>
    | Awaited<ReturnType<ReturnType<typeof createWeeklyDayOffService>["updateAssignment"]>>
): asserts value is WeeklyDayOffAssignmentRecord {
  expect("error" in value).toBe(false);
}
