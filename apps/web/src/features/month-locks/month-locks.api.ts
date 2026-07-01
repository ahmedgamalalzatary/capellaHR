import { api } from "@/shared/lib/api-client";
import type {
  MonthLockCreatePayload,
  MonthLockFilters,
  MonthLockResponse,
  MonthLocksResponse
} from "@/features/month-locks/month-locks.types";

export const monthLocksApi = {
  list: (filters: MonthLockFilters) =>
    api.get<MonthLocksResponse>("/month-locks", {
      query: filters
    }),
  create: (payload: MonthLockCreatePayload) =>
    api.post<MonthLockResponse>("/month-locks", {
      json: payload
    })
};
