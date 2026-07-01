import type { AuditLogFilters } from "@/features/audit-logs/audit-logs.types";

export const auditLogKeys = {
  all: ["audit-logs"] as const,
  list: (filters: AuditLogFilters) => [...auditLogKeys.all, "list", filters] as const
};
