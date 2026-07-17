import { z } from 'zod';

const databaseId = z.coerce.number().int().positive().max(2147483647);

export const shiftDurationMinutesSchema = z.number().int().min(1).max(720);
export const coercedShiftDurationMinutesSchema = z.preprocess(
  (value) => typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  shiftDurationMinutesSchema,
);

export const shiftEmployeeParamsSchema = z.object({
  employeeId: databaseId,
});

export const updateShiftAssignmentSchema = z.object({
  durationMinutes: shiftDurationMinutesSchema,
}).strict();

export const listShiftAssignmentsQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  branchId: databaseId.optional(),
  page: z.coerce.number().int().positive().max(2147483647).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type UpdateShiftAssignmentInput = z.infer<typeof updateShiftAssignmentSchema>;
export type ListShiftAssignmentsQuery = z.infer<typeof listShiftAssignmentsQuerySchema>;
