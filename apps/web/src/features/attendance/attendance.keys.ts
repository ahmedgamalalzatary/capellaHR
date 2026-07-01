import type { AttendanceHistoryFilters } from "@/features/attendance/attendance.types";

export const attendanceKeys = {
  all: ["attendance"] as const,
  current: () => [...attendanceKeys.all, "current"] as const,
  histories: () => [...attendanceKeys.all, "history"] as const,
  history: (filters?: AttendanceHistoryFilters) =>
    [...attendanceKeys.histories(), filters ?? {}] as const
};
