import { z } from "zod";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const weeklyDayOffAssignmentCreateSchema = z.object({
  dayOffDate: isoDateSchema,
  overrideReason: z.string().trim().min(1).max(1000).optional()
});

export const weeklyDayOffAssignmentUpdateSchema = z.object({
  dayOffDate: isoDateSchema,
  overrideReason: z.string().trim().min(1).max(1000).nullable().optional()
});

export const weeklyDayOffAssignmentListFilterSchema = z.object({
  weekStartDate: isoDateSchema.optional()
});
