import { describe, expect, it } from "vitest";
import type { PermissionAbsenceCreateInput } from "@capella/shared";
import { createPermissionAbsenceService } from "../../../../src/modules/permission-absences/service";
import type {
  PermissionAbsenceRecord,
  PermissionAbsenceRepository
} from "../../../../src/modules/permission-absences/service";

class InMemoryPermissionAbsenceRepository implements PermissionAbsenceRepository {
  employees = new Set([1]);
  absences: PermissionAbsenceRecord[] = [];
  attendanceDates = new Set<string>();
  lockedMonths = new Set<string>();
  nextId = 1;

  async findEmployeeById(employeeId: number) {
    return this.employees.has(employeeId) ? { id: employeeId } : null;
  }

  async listAbsences(employeeId: number, monthKey?: string) {
    return this.absences.filter((absence) =>
      absence.employeeId === employeeId
      && (!monthKey || absence.absenceDate.startsWith(monthKey))
    );
  }

  async findAbsenceById(absenceId: number) {
    return this.absences.find((absence) => absence.id === absenceId) ?? null;
  }

  async hasAttendanceOnDate(employeeId: number, absenceDate: string) {
    return this.attendanceDates.has(`${employeeId}:${absenceDate}`);
  }

  async isMonthLocked(monthKey: string) {
    return this.lockedMonths.has(monthKey);
  }

  async createAbsence(input: {
    employeeId: number;
    absenceDate: string;
    createdByAdminId: number;
  }) {
    const absence: PermissionAbsenceRecord = {
      id: this.nextId++,
      employeeId: input.employeeId,
      absenceDate: input.absenceDate,
      permissionType: "generic",
      reason: null,
      createdByAdminId: input.createdByAdminId,
      updatedByAdminId: null
    };

    this.absences.push(absence);
    return absence;
  }

  async updateAbsence(absenceId: number, input: { absenceDate: string; updatedByAdminId: number }) {
    const absence = this.absences.find((item) => item.id === absenceId) ?? null;

    if (!absence) {
      return null;
    }

    absence.absenceDate = input.absenceDate;
    absence.updatedByAdminId = input.updatedByAdminId;

    return absence;
  }
}

describe("permission absence service", () => {
  it("creates a generic permission absence for an employee", async () => {
    const repository = new InMemoryPermissionAbsenceRepository();
    const service = createPermissionAbsenceService({ repository });

    const result = await service.createAbsence(1, validCreateInput("2026-06-29"), 9);

    assertAbsence(result);
    expect(result.permissionType).toBe("generic");
    expect(result.createdByAdminId).toBe(9);
  });

  it("blocks creation when attendance already exists on that date", async () => {
    const repository = new InMemoryPermissionAbsenceRepository();
    repository.attendanceDates.add("1:2026-06-29");
    const service = createPermissionAbsenceService({ repository });

    const result = await service.createAbsence(1, validCreateInput("2026-06-29"), 9);

    expect(result).toEqual({
      error: {
        code: "PERMISSION_ABSENCE_ATTENDANCE_CONFLICT",
        message: "Permission absence conflicts with existing attendance",
        details: {}
      }
    });
  });

  it("blocks creation inside a locked month", async () => {
    const repository = new InMemoryPermissionAbsenceRepository();
    repository.lockedMonths.add("2026-06");
    const service = createPermissionAbsenceService({ repository });

    const result = await service.createAbsence(1, validCreateInput("2026-06-29"), 9);

    expect(result).toEqual({
      error: {
        code: "MONTH_LOCKED",
        message: "The month is locked",
        details: {}
      }
    });
  });

  it("returns not found when the employee does not exist", async () => {
    const repository = new InMemoryPermissionAbsenceRepository();
    repository.employees.delete(1);
    const service = createPermissionAbsenceService({ repository });

    const result = await service.createAbsence(1, validCreateInput("2026-06-29"), 9);

    expect(result).toEqual({
      error: {
        code: "EMPLOYEE_NOT_FOUND",
        message: "Employee not found",
        details: {}
      }
    });
  });

  it("updates an existing permission absence", async () => {
    const repository = new InMemoryPermissionAbsenceRepository();
    repository.absences.push({
      id: 1,
      employeeId: 1,
      absenceDate: "2026-06-29",
      permissionType: "generic",
      reason: null,
      createdByAdminId: 1,
      updatedByAdminId: null
    });
    const service = createPermissionAbsenceService({ repository });

    const result = await service.updateAbsence(1, { absenceDate: "2026-06-30" }, 9);

    assertAbsence(result);
    expect(result.absenceDate).toBe("2026-06-30");
    expect(result.updatedByAdminId).toBe(9);
  });
});

function validCreateInput(absenceDate: string): PermissionAbsenceCreateInput {
  return { absenceDate };
}

function assertAbsence(
  value: Awaited<ReturnType<ReturnType<typeof createPermissionAbsenceService>["createAbsence"]>>
    | Awaited<ReturnType<ReturnType<typeof createPermissionAbsenceService>["updateAbsence"]>>
): asserts value is PermissionAbsenceRecord {
  expect("error" in value).toBe(false);
}
