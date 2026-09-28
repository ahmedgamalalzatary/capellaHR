import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../common/index.ts';
import { moneyAmountSchema, payrollAmountOrDaysShape, payrollDaysSchema, payrollMonthSchema } from '../payroll/index.ts';

export const bonusParamsSchema = z.object({ bonusId: coercedMysqlIntSchema });
export const bonusReasonSchema = z.string().trim().min(1).max(500);
export const createBonusSchema = z.object({
  employeeId: coercedMysqlIntSchema,
  ...payrollAmountOrDaysShape,
  payrollMonth: payrollMonthSchema,
  reason: bonusReasonSchema,
}).strict().refine((value) => (value.amount === undefined) !== (value.days === undefined), {
  message: 'حدد المبلغ أو عدد الأيام، أحدهما فقط',
});
export const updateBonusSchema = z.object({
  amount: moneyAmountSchema.optional(),
  days: payrollDaysSchema.optional(),
  payrollMonth: payrollMonthSchema.optional(),
  reason: bonusReasonSchema,
}).strict().refine((value) => value.amount === undefined || value.days === undefined, {
  message: 'حدد المبلغ أو عدد الأيام، أحدهما فقط',
});
export const listBonusesQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  branchId: coercedMysqlIntSchema.optional(),
  employeeId: coercedMysqlIntSchema.optional(),
  payrollMonth: payrollMonthSchema.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).strict();

export type CreateBonusInput = z.infer<typeof createBonusSchema>;
export type UpdateBonusInput = z.infer<typeof updateBonusSchema>;
export type ListBonusesQuery = z.infer<typeof listBonusesQuerySchema>;
