import { useMutation, useQuery } from "@tanstack/react-query";

import { reportsApi } from "@/features/reports/reports.api";
import { reportsKeys } from "@/features/reports/reports.keys";
import type {
  AttendanceExportFilters,
  EmployeeExportFilters,
  MonthlyAttendanceSummaryFilters
} from "@/features/reports/reports.types";

export function useMonthlyAttendanceSummary(filters: MonthlyAttendanceSummaryFilters) {
  return useQuery({
    queryKey: reportsKeys.monthlySummary(filters),
    queryFn: () => reportsApi.monthlyAttendanceSummary(filters)
  });
}

export function useExportEmployeesPdf() {
  return useMutation({
    mutationFn: (filters?: Partial<EmployeeExportFilters>) => reportsApi.exportEmployeesPdf(filters)
  });
}

export function useExportAttendancePdf() {
  return useMutation({
    mutationFn: (filters?: Partial<AttendanceExportFilters>) => reportsApi.exportAttendancePdf(filters)
  });
}

export function useExportMonthlyAttendanceSummaryPdf() {
  return useMutation({
    mutationFn: (filters: MonthlyAttendanceSummaryFilters) =>
      reportsApi.exportMonthlyAttendanceSummaryPdf(filters)
  });
}
