import type { z } from "zod";
import type { auditLogListFilterSchema } from "../schemas/audit-logs";

export type AuditLogListFilterInput = z.infer<typeof auditLogListFilterSchema>;
