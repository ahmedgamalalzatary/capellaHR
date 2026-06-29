import type { EmployeeListFilters } from "@/features/employees/employees.types";

/** Query-key factory for the employees feature. Single source of cache keys. */
export const employeeKeys = {
  all: ["employees"] as const,
  lists: () => [...employeeKeys.all, "list"] as const,
  list: (filters?: EmployeeListFilters) => [...employeeKeys.lists(), filters ?? {}] as const,
  details: () => [...employeeKeys.all, "detail"] as const,
  detail: (employeeId: number) => [...employeeKeys.details(), employeeId] as const,
  files: (employeeId: number) => [...employeeKeys.detail(employeeId), "files"] as const,
  assignments: (employeeId: number) =>
    [...employeeKeys.detail(employeeId), "assignments"] as const,
  device: (employeeId: number) => [...employeeKeys.detail(employeeId), "device"] as const
};
