import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../common/index.js';

export const moneyAmountSchema = z.string()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'المبلغ يجب أن يكون رقمًا موجبًا بحد أقصى منزلتين عشريتين')
  .transform((value, context) => {
    const [whole = '', fraction = ''] = value.split('.');
    const normalized = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
    if (normalized === '0.00') {
      context.addIssue({ code: 'custom', message: 'المبلغ يجب أن يكون أكبر من صفر' });
      return z.NEVER;
    }
    return normalized;
  });

export const payrollMonthSchema = z.string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'شهر الراتب غير صالح');

export const payrollEmployeeParamsSchema = z.object({
  employeeId: coercedMysqlIntSchema,
});
export const payrollEmployeeMonthParamsSchema = payrollEmployeeParamsSchema.extend({
  month: payrollMonthSchema,
});
export const payrollBranchMonthParamsSchema = z.object({
  branchId: coercedMysqlIntSchema,
  month: payrollMonthSchema,
});
export const updateBaseSalarySchema = z.object({ amount: moneyAmountSchema }).strict();
export const listPayrollMonthsQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  branchId: coercedMysqlIntSchema.optional(),
  month: payrollMonthSchema,
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).strict();

export type PayrollMonth = z.infer<typeof payrollMonthSchema>;
export type UpdateBaseSalaryInput = z.infer<typeof updateBaseSalarySchema>;
export type ListPayrollMonthsQuery = z.infer<typeof listPayrollMonthsQuerySchema>;
