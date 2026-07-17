import { z } from 'zod';
import {
  coercedMysqlIntSchema,
  decimalIntegerInput,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../common/index.js';

const databaseId = coercedMysqlIntSchema;

export const shiftDurationMinutesSchema = z.number().int().min(1).max(720);
export const coercedShiftDurationMinutesSchema = z.preprocess(
  decimalIntegerInput,
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
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
});

export type UpdateShiftAssignmentInput = z.infer<typeof updateShiftAssignmentSchema>;
export type ListShiftAssignmentsQuery = z.infer<typeof listShiftAssignmentsQuerySchema>;
