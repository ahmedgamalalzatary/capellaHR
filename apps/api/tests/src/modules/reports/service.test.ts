import { describe, expect, it } from "vitest";
import { createReportsService, type MonthlyAttendanceSummaryRow, type ReportsRepository } from "../../../../src/modules/reports/service";

class InMemoryReportsRepository implements ReportsRepository {
  employees: Array<{
    id: number;
    fullName: string;
    branchId: number | null;
    branchName: string | null;
  }> = [];
  attendanceDates = new Map<number, string[]>();
  weeklyDayOffDates = new Map<number, string[]>();
  permissionAbsenceDates = new Map<number, string[]>();

  async listEmployees(filters: { employeeId?: number; branchId?: number }) {
    return this.employees.filter((employee) =>
      (!filters.employeeId || employee.id === filters.employeeId)
      && (!filters.branchId || employee.branchId === filters.branchId)
    );
  }

  async listCompletedAttendanceDates(employeeId: number, month: string) {
    return (this.attendanceDates.get(employeeId) ?? []).filter((date) => date.startsWith(month));
  }

  async listWeeklyDayOffDates(employeeId: number, month: string) {
    return (this.weeklyDayOffDates.get(employeeId) ?? []).filter((date) => date.startsWith(month));
  }

  async listPermissionAbsenceDates(employeeId: number, month: string) {
    return (this.permissionAbsenceDates.get(employeeId) ?? []).filter((date) => date.startsWith(month));
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
    repository.attendanceDates.set(1, [
      "2026-06-01",
      "2026-06-01",
      "2026-06-02",
      "2026-06-15"
    ]);
    repository.weeklyDayOffDates.set(1, [
      "2026-06-06",
      "2026-06-13",
      "2026-06-20",
      "2026-06-27"
    ]);
    repository.permissionAbsenceDates.set(1, [
      "2026-06-10",
      "2026-06-11"
    ]);
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
    // 2026-06-10 is shared between attendance and a permission absence,
    // and 2026-06-06 is shared between attendance and a weekly day off.
    repository.attendanceDates.set(1, ["2026-06-06", "2026-06-10"]);
    repository.weeklyDayOffDates.set(1, ["2026-06-06"]);
    repository.permissionAbsenceDates.set(1, ["2026-06-10"]);
    const service = createReportsService({ repository });

    const result = await service.getMonthlyAttendanceSummary({
      month: "2026-06"
    });

    // Only 2 distinct calendar days are covered, so 30 - 2 = 28 remain absent.
    expect(result[0]?.absenceWithoutPermission).toBe(28);
  });

  it("filters the summary by employee and branch", async () => {
    const repository = new InMemoryReportsRepository();
    repository.employees = [
      {
        id: 1,
        fullName: "Mina Adel",
        branchId: 2,
        branchName: "Nasr City"
      },
      {
        id: 2,
        fullName: "Sara Nabil",
        branchId: 3,
        branchName: "Maadi"
      }
    ];
    const service = createReportsService({ repository });

    const result = await service.getMonthlyAttendanceSummary({
      month: "2026-06",
      branchId: 3
    });

    expect(result).toEqual<MonthlyAttendanceSummaryRow[]>([
      {
        employeeId: 2,
        employeeName: "Sara Nabil",
        branchId: 3,
        branchName: "Maadi",
        month: "2026-06",
        attendanceDays: 0,
        weeklyDaysOff: 0,
        absenceWithPermission: 0,
        absenceWithoutPermission: 30
      }
    ]);
  });
});
