import { z } from "zod";
import { paginationSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const auditLogListFilterSchema = paginationSchema.extend({
  entityType: z.string().trim().min(1).max(100).optional(),
  actionType: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(255).optional(),
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional()
});
