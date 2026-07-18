import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../common/index.js';
import { moneyAmountSchema, payrollMonthSchema } from '../payroll/index.js';

export const deductionParamsSchema = z.object({ deductionId: coercedMysqlIntSchema });
export const createDeductionSchema = z.object({
  employeeId: coercedMysqlIntSchema,
  amount: moneyAmountSchema,
  payrollMonth: payrollMonthSchema,
}).strict();
export const updateDeductionSchema = createDeductionSchema.omit({ employeeId: true })
  .partial().strict().refine((value) => Object.keys(value).length > 0, 'يجب إرسال تعديل واحد على الأقل');
export const listDeductionsQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  branchId: coercedMysqlIntSchema.optional(),
  employeeId: coercedMysqlIntSchema.optional(),
  payrollMonth: payrollMonthSchema.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).strict();

export type CreateDeductionInput = z.infer<typeof createDeductionSchema>;
export type UpdateDeductionInput = z.infer<typeof updateDeductionSchema>;
export type ListDeductionsQuery = z.infer<typeof listDeductionsQuerySchema>;
