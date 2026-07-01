import type {
  AttendanceListFilterInput,
  EmployeeListFilterInput,
  MonthlyAttendanceSummaryFilterInput
} from "@capella/shared/contracts";

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

export type MonthlyAttendanceSummaryResponse = {
  summaries: MonthlyAttendanceSummaryRow[];
};

export type MonthlyAttendanceSummaryFilters = MonthlyAttendanceSummaryFilterInput;
export type EmployeeExportFilters = EmployeeListFilterInput;
export type AttendanceExportFilters = AttendanceListFilterInput;
