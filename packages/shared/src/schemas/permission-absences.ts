import { z } from "zod";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthKeySchema = z.string().regex(/^\d{4}-\d{2}$/);

export const permissionAbsenceCreateSchema = z.object({
  absenceDate: isoDateSchema
});

export const permissionAbsenceUpdateSchema = z.object({
  absenceDate: isoDateSchema
});

export const permissionAbsenceListFilterSchema = z.object({
  monthKey: monthKeySchema.optional()
});
