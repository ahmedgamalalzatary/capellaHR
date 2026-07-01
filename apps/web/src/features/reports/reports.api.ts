import { api } from "@/shared/lib/api-client";
import type {
  AttendanceExportFilters,
  EmployeeExportFilters,
  MonthlyAttendanceSummaryFilters,
  MonthlyAttendanceSummaryResponse
} from "@/features/reports/reports.types";

export const reportsApi = {
  monthlyAttendanceSummary: (filters: MonthlyAttendanceSummaryFilters) =>
    api.get<MonthlyAttendanceSummaryResponse>("/reports/monthly-attendance-summary", {
      query: filters
    }),

  exportEmployeesPdf: (filters?: Partial<EmployeeExportFilters>) =>
    api.getBlob("/reports/employees/export.pdf", { query: filters }),

  exportAttendancePdf: (filters?: Partial<AttendanceExportFilters>) =>
    api.getBlob("/reports/attendance/export.pdf", { query: filters }),

  exportMonthlyAttendanceSummaryPdf: (filters: MonthlyAttendanceSummaryFilters) =>
    api.getBlob("/reports/monthly-attendance-summary/export.pdf", { query: filters })
};
