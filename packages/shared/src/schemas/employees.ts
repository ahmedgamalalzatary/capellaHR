import { z } from "zod";
import { egyptianPhoneSchema, emailSchema, paginationSchema } from "./common";

export const employeeCreateSchema = z.object({
  fullName: z.string().trim().min(1),
  password: z.string().min(8),
  primaryPhone: egyptianPhoneSchema,
  whatsappPhone: egyptianPhoneSchema,
  email: emailSchema.optional(),
  branchId: z.coerce.number().int().positive(),
  age: z.coerce.number(),
  address: z.string().trim().min(1),
  currentMonthlySalary: z.union([z.string(), z.number()]).transform((value) => String(value))
});

export const employeeUpdateSchema = employeeCreateSchema.partial().extend({
  password: z.string().min(8).optional()
});

export const employeeListFilterSchema = paginationSchema.extend({
  search: z.string().trim().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  status: z.enum(["active", "soft_deleted"]).optional()
});

export const employeeBranchAssignmentCreateSchema = z.object({
  branchId: z.coerce.number().int().positive(),
  effectiveFrom: z.string().datetime()
});
