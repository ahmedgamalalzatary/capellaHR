import { api } from "@/shared/lib/api-client";
import type {
  AuditLogFilters,
  AuditLogListResponse
} from "@/features/audit-logs/audit-logs.types";

export const auditLogsApi = {
  list: (filters: AuditLogFilters) =>
    api.get<AuditLogListResponse>("/audit-logs", {
      query: filters
    })
};
