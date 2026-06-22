import { z } from "zod";

const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const monthLockCreateSchema = z.object({
  monthKey: monthKeySchema,
  notes: z.string().trim().min(1).max(1000).optional()
});

export const monthLockListFilterSchema = z.object({
  monthKey: monthKeySchema.optional()
});
