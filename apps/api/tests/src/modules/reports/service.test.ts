import { describe, expect, it } from "vitest";
import { createReportsService, type MonthlyAttendanceSummaryRow, type ReportsRepository } from "../../../../src/modules/reports/service";

class InMemoryReportsRepository implements ReportsRepository {
  employees: Array<{
    id: number;
    fullName: string;
    branchId: number | null;
    branchName: string | null;
  }> = [];
  attendanceDates = new Map<number, Array<{
    date: string;
    branchId: number | null;
    branchName: string | null;
  }>>();
  weeklyDayOffDates = new Map<number, string[]>();
  permissionAbsenceDates = new Map<number, string[]>();
  branchAssignments = new Map<number, Array<{
    branchId: number;
    branchName: string;
    effectiveFrom: string;
    effectiveTo: null | string;
  }>>();

  async listEmployees(filters: { employeeId?: number }) {
    return this.employees.filter((employee) => !filters.employeeId || employee.id === filters.employeeId);
  }

  async listCompletedAttendanceDates(employeeId: number, month: string) {
    return (this.attendanceDates.get(employeeId) ?? []).filter((entry) => entry.date.startsWith(month));
  }

  async listWeeklyDayOffDates(employeeId: number, month: string) {
    return (this.weeklyDayOffDates.get(employeeId) ?? []).filter((date) => date.startsWith(month));
  }

  async listPermissionAbsenceDates(employeeId: number, month: string) {
    return (this.permissionAbsenceDates.get(employeeId) ?? []).filter((date) => date.startsWith(month));
  }

  async listBranchAssignments(employeeId: number) {
    return this.branchAssignments.get(employeeId) ?? [];
  }
}

describe("reports service", () => {
  it("calculates the monthly attendance summary using distinct classified dates", async () => {
    const repository = new InMemoryReportsRepository();
    repository.employees = [
      {
        id: 1,
        fullName: "Mina Adel",
        branchId: 2,
        branchName: "Nasr City"
      }
    ];
    repository.branchAssignments.set(1, [
      {
        branchId: 2,
        branchName: "Nasr City",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null
      }
    ]);
    repository.attendanceDates.set(1, [
      { date: "2026-06-01", branchId: 2, branchName: "Nasr City" },
      { date: "2026-06-01", branchId: 2, branchName: "Nasr City" },
      { date: "2026-06-02", branchId: 2, branchName: "Nasr City" },
      { date: "2026-06-15", branchId: 2, branchName: "Nasr City" }
    ]);
    repository.weeklyDayOffDates.set(1, ["2026-06-06", "2026-06-13", "2026-06-20", "2026-06-27"]);
    repository.permissionAbsenceDates.set(1, ["2026-06-10", "2026-06-11"]);
    const service = createReportsService({ repository });

    const result = await service.getMonthlyAttendanceSummary({
      month: "2026-06"
    });

    expect(result).toEqual<MonthlyAttendanceSummaryRow[]>([
      {
        employeeId: 1,
        employeeName: "Mina Adel",
        branchId: 2,
        branchName: "Nasr City",
        month: "2026-06",
        attendanceDays: 3,
        weeklyDaysOff: 4,
        absenceWithPermission: 2,
        absenceWithoutPermission: 21
      }
    ]);
  });

  it("counts each calendar day once when records overlap", async () => {
    const repository = new InMemoryReportsRepository();
    repository.employees = [
      {
        id: 1,
        fullName: "Mina Adel",
        branchId: 2,
        branchName: "Nasr City"
      }
    ];
    repository.branchAssignments.set(1, [
      {
        branchId: 2,
        branchName: "Nasr City",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null
      }
    ]);
    repository.attendanceDates.set(1, [
      { date: "2026-06-06", branchId: 2, branchName: "Nasr City" },
      { date: "2026-06-10", branchId: 2, branchName: "Nasr City" }
    ]);
    repository.weeklyDayOffDates.set(1, ["2026-06-06"]);
    repository.permissionAbsenceDates.set(1, ["2026-06-10"]);
    const service = createReportsService({ repository });

    const result = await service.getMonthlyAttendanceSummary({
      month: "2026-06"
    });

    expect(result[0]?.absenceWithoutPermission).toBe(28);
  });

  it("filters the summary by historical branch", async () => {
    const repository = new InMemoryReportsRepository();
    repository.employees = [
      {
        id: 1,
        fullName: "Mina Adel",
        branchId: 3,
        branchName: "Maadi"
      }
    ];
    repository.branchAssignments.set(1, [
      {
        branchId: 2,
        branchName: "Nasr City",
        effectiveFrom: "2026-06-01T00:00:00.000Z",
        effectiveTo: "2026-06-16T00:00:00.000Z"
      },
      {
        branchId: 3,
        branchName: "Maadi",
        effectiveFrom: "2026-06-16T00:00:00.000Z",
        effectiveTo: null
      }
    ]);
    const service = createReportsService({ repository });

    const result = await service.getMonthlyAttendanceSummary({
      month: "2026-06",
      branchId: 2
    });

    expect(result).toEqual<MonthlyAttendanceSummaryRow[]>([
      {
        employeeId: 1,
        employeeName: "Mina Adel",
        branchId: 2,
        branchName: "Nasr City",
        month: "2026-06",
        attendanceDays: 0,
        weeklyDaysOff: 0,
        absenceWithPermission: 0,
        absenceWithoutPermission: 15
      }
    ]);
  });

  it("splits monthly summary rows by historical branch assignment", async () => {
    const repository = new InMemoryReportsRepository();
    repository.employees = [
      {
        id: 1,
        fullName: "Mina Adel",
        branchId: 3,
        branchName: "Maadi"
      }
    ];
    repository.branchAssignments.set(1, [
      {
        branchId: 2,
        branchName: "Nasr City",
        effectiveFrom: "2026-06-01T00:00:00.000Z",
        effectiveTo: "2026-06-16T00:00:00.000Z"
      },
      {
        branchId: 3,
        branchName: "Maadi",
        effectiveFrom: "2026-06-16T00:00:00.000Z",
        effectiveTo: null
      }
    ]);
    repository.attendanceDates.set(1, [
      { date: "2026-06-02", branchId: 2, branchName: "Nasr City" },
      { date: "2026-06-18", branchId: 3, branchName: "Maadi" }
    ]);
    repository.weeklyDayOffDates.set(1, ["2026-06-06", "2026-06-20"]);
    repository.permissionAbsenceDates.set(1, ["2026-06-10", "2026-06-25"]);
    const service = createReportsService({ repository });

    const result = await service.getMonthlyAttendanceSummary({
      month: "2026-06"
    });

    expect(result).toEqual<MonthlyAttendanceSummaryRow[]>([
      {
        employeeId: 1,
        employeeName: "Mina Adel",
        branchId: 2,
        branchName: "Nasr City",
        month: "2026-06",
        attendanceDays: 1,
        weeklyDaysOff: 1,
        absenceWithPermission: 1,
        absenceWithoutPermission: 12
      },
      {
        employeeId: 1,
        employeeName: "Mina Adel",
        branchId: 3,
        branchName: "Maadi",
        month: "2026-06",
        attendanceDays: 1,
        weeklyDaysOff: 1,
        absenceWithPermission: 1,
        absenceWithoutPermission: 12
      }
    ]);
  });
});
