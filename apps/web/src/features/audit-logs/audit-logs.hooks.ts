import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { auditLogsApi } from "@/features/audit-logs/audit-logs.api";
import { auditLogKeys } from "@/features/audit-logs/audit-logs.keys";
import type { AuditLogFilters } from "@/features/audit-logs/audit-logs.types";

export function useAuditLogs(filters: AuditLogFilters) {
  return useQuery({
    queryKey: auditLogKeys.list(filters),
    queryFn: () => auditLogsApi.list(filters),
    placeholderData: keepPreviousData
  });
}
