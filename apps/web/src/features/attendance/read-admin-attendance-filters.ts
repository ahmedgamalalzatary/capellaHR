import type { AdminAttendanceFilters } from "@/features/attendance/attendance.types";

const STATUSES = ["open", "completed"] as const;
const SORT_BY = ["check_in_at", "employee_name"] as const;
const SORT_DIRECTIONS = ["asc", "desc"] as const;

export function readAdminAttendanceFilters(
  get: (key: string) => string | null
): AdminAttendanceFilters {
  const filters: AdminAttendanceFilters = { page: 1, pageSize: 20 };

  const page = Number(get("page"));
  if (Number.isInteger(page) && page > 0) {
    filters.page = page;
  }

  const employeeName = get("employeeName")?.trim();
  if (employeeName) {
    filters.employeeName = employeeName;
  }

  const branchId = Number(get("branchId"));
  if (Number.isInteger(branchId) && branchId > 0) {
    filters.branchId = branchId;
  }

  const status = get("status");
  if (status && (STATUSES as readonly string[]).includes(status)) {
    filters.status = status as AdminAttendanceFilters["status"];
  }

  const dateFrom = get("dateFrom")?.trim();
  if (dateFrom) {
    filters.dateFrom = dateFrom;
  }

  const dateTo = get("dateTo")?.trim();
  if (dateTo) {
    filters.dateTo = dateTo;
  }

  const sortBy = get("sortBy");
  if (sortBy && (SORT_BY as readonly string[]).includes(sortBy)) {
    filters.sortBy = sortBy as AdminAttendanceFilters["sortBy"];
  }

  const sortDirection = get("sortDirection");
  if (sortDirection && (SORT_DIRECTIONS as readonly string[]).includes(sortDirection)) {
    filters.sortDirection = sortDirection as AdminAttendanceFilters["sortDirection"];
  }

  return filters;
}
