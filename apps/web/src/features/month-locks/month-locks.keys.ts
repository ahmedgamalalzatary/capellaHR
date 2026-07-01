import type { MonthLockFilters } from "@/features/month-locks/month-locks.types";

export const monthLockKeys = {
  all: ["month-locks"] as const,
  list: (filters: MonthLockFilters) => [...monthLockKeys.all, filters] as const
};
