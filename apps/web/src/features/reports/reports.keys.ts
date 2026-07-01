import type { MonthlyAttendanceSummaryFilters } from "@/features/reports/reports.types";

export const reportsKeys = {
  all: ["reports"] as const,
  monthlySummary: (filters: MonthlyAttendanceSummaryFilters) =>
    [...reportsKeys.all, "monthly-attendance-summary", filters] as const
};
