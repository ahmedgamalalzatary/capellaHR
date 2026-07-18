import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../common/index.js';
import { moneyAmountSchema, payrollMonthSchema } from '../payroll/index.js';

export const bonusParamsSchema = z.object({ bonusId: coercedMysqlIntSchema });
export const createBonusSchema = z.object({
  employeeId: coercedMysqlIntSchema,
  amount: moneyAmountSchema,
  payrollMonth: payrollMonthSchema,
}).strict();
export const updateBonusSchema = createBonusSchema.omit({ employeeId: true })
  .partial().strict().refine((value) => Object.keys(value).length > 0, 'يجب إرسال تعديل واحد على الأقل');
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
