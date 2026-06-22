import { z } from "zod";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const auditLogListFilterSchema = z.object({
  entityType: z.string().trim().min(1).max(100).optional(),
  actionType: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(255).optional(),
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional()
});
