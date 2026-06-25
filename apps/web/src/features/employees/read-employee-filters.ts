import type { EmployeeListFilters, EmployeeStatus } from "@/features/employees/employees.types";

const EMPLOYEE_STATUSES: EmployeeStatus[] = ["active", "soft_deleted"];

/**
 * Derive typed employee list filters from a URL param getter (the single source
 * of truth for list state). Invalid/absent values are dropped so the resulting
 * object is safe to pass straight to the list query.
 */
export function readEmployeeFilters(get: (key: string) => string | null): EmployeeListFilters {
  const filters: EmployeeListFilters = { page: 1 };

  const page = Number(get("page"));
  if (Number.isInteger(page) && page > 0) {
    filters.page = page;
  }

  const search = get("search")?.trim();
  if (search) {
    filters.search = search;
  }

  const branchId = Number(get("branchId"));
  if (Number.isInteger(branchId) && branchId > 0) {
    filters.branchId = branchId;
  }

  const status = get("status");
  if (status && (EMPLOYEE_STATUSES as string[]).includes(status)) {
    filters.status = status as EmployeeStatus;
  }

  return filters;
}
