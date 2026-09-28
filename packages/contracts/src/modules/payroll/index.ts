import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../common/index.ts';

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

/**
 * A day count for an amount priced off the employee's own day rate. Bounded by a full
 * month because a bonus or deduction past that is a mistyped form, not a bigger award.
 */
export const payrollDaysSchema = z.number({
  invalid_type_error: 'عدد الأيام غير صالح',
  required_error: 'عدد الأيام غير صالح',
}).int('عدد الأيام يجب أن يكون رقمًا صحيحًا').min(1, 'عدد الأيام يجب أن يكون أكبر من صفر').max(31, 'عدد الأيام يجب ألا يتجاوز 31 يومًا');

/**
 * Exactly one way of saying what a bonus or deduction is worth: a day count, which the
 * server prices, or an amount typed outright. Both would leave the figure ambiguous and
 * neither would say nothing at all.
 */
export const payrollAmountOrDaysShape = {
  amount: moneyAmountSchema.optional(),
  days: payrollDaysSchema.optional(),
};
export const payrollAmountOrDaysSchema = z.object(payrollAmountOrDaysShape).refine(
  (value) => (value.amount === undefined) !== (value.days === undefined),
  { message: 'حدد المبلغ أو عدد الأيام، أحدهما فقط' },
);

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
