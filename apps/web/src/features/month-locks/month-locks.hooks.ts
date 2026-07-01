import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { monthLocksApi } from "@/features/month-locks/month-locks.api";
import { monthLockKeys } from "@/features/month-locks/month-locks.keys";
import type {
  MonthLockCreatePayload,
  MonthLockFilters
} from "@/features/month-locks/month-locks.types";

export function useMonthLocks(filters: MonthLockFilters) {
  return useQuery({
    queryKey: monthLockKeys.list(filters),
    queryFn: () => monthLocksApi.list(filters)
  });
}

export function useCreateMonthLock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: MonthLockCreatePayload) => monthLocksApi.create(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: monthLockKeys.all })
  });
}
