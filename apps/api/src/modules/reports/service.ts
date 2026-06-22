import type { MonthlyAttendanceSummaryFilterInput } from "@capella/shared";

export type MonthlyAttendanceSummaryRow = {
  employeeId: number;
  employeeName: string;
  branchId: number | null;
  branchName: string | null;
  month: string;
  attendanceDays: number;
  weeklyDaysOff: number;
  absenceWithPermission: number;
  absenceWithoutPermission: number;
};

type EmployeeSummaryBase = {
  id: number;
  fullName: string;
  branchId: number | null;
  branchName: string | null;
};

export type ReportsRepository = {
  listEmployees(filters: {
    employeeId?: number;
    branchId?: number;
  }): Promise<EmployeeSummaryBase[]>;
  listCompletedAttendanceDates(employeeId: number, month: string): Promise<string[]>;
  listWeeklyDayOffDates(employeeId: number, month: string): Promise<string[]>;
  listPermissionAbsenceDates(employeeId: number, month: string): Promise<string[]>;
};

type CreateReportsServiceOptions = {
  repository: ReportsRepository;
};

export function createReportsService(options: CreateReportsServiceOptions) {
  return {
    async getMonthlyAttendanceSummary(filters: MonthlyAttendanceSummaryFilterInput) {
      const employees = await options.repository.listEmployees({
        employeeId: filters.employeeId,
        branchId: filters.branchId
      });

      const summaries = await Promise.all(
        employees.map(async (employee) => {
          const [attendanceDates, weeklyDayOffDates, permissionAbsenceDates] = await Promise.all([
            options.repository.listCompletedAttendanceDates(employee.id, filters.month),
            options.repository.listWeeklyDayOffDates(employee.id, filters.month),
            options.repository.listPermissionAbsenceDates(employee.id, filters.month)
          ]);

          const distinctAttendanceDays = new Set(attendanceDates).size;
          const distinctWeeklyDaysOff = new Set(weeklyDayOffDates).size;
          const distinctPermissionAbsences = new Set(permissionAbsenceDates).size;
          const coveredDays = new Set([
            ...attendanceDates,
            ...weeklyDayOffDates,
            ...permissionAbsenceDates
          ]).size;
          const daysInMonth = getDaysInMonth(filters.month);

          return {
            employeeId: employee.id,
            employeeName: employee.fullName,
            branchId: employee.branchId,
            branchName: employee.branchName,
            month: filters.month,
            attendanceDays: distinctAttendanceDays,
            weeklyDaysOff: distinctWeeklyDaysOff,
            absenceWithPermission: distinctPermissionAbsences,
            absenceWithoutPermission: daysInMonth - coveredDays
          } satisfies MonthlyAttendanceSummaryRow;
        })
      );

      return summaries;
    }
  };
}

function getDaysInMonth(month: string) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);

  return new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
}
