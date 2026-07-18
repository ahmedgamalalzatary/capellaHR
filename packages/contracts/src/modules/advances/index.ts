import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../common/index.js';
import { moneyAmountSchema, payrollMonthSchema } from '../payroll/index.js';

export const installmentCountSchema = z.number().int().min(1).max(4);
export const advanceParamsSchema = z.object({ advanceId: coercedMysqlIntSchema });
const validateSchedule = (
  value: {
    amount?: string | undefined;
    installmentCount?: number | undefined;
    startMonth?: string | undefined;
  },
  context: z.RefinementCtx,
) => {
  if (value.amount !== undefined && value.installmentCount !== undefined) {
    const [whole = '0', fraction = ''] = value.amount.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (cents < value.installmentCount) {
      context.addIssue({ code: 'custom', path: ['amount'], message: 'المبلغ لا يكفي لإنشاء أقساط موجبة' });
    }
  }
  if (value.startMonth !== undefined && value.installmentCount !== undefined) {
    const [year, month] = value.startMonth.split('-').map(Number) as [number, number];
    if (year * 12 + month - 1 + value.installmentCount - 1 > 9999 * 12 + 11) {
      context.addIssue({ code: 'custom', path: ['startMonth'], message: 'جدول الأقساط يتجاوز نطاق التاريخ المدعوم' });
    }
  }
};

const advanceFieldsSchema = z.object({
  employeeId: coercedMysqlIntSchema,
  amount: moneyAmountSchema,
  installmentCount: installmentCountSchema,
  startMonth: payrollMonthSchema,
}).strict();
export const createAdvanceSchema = advanceFieldsSchema.superRefine(validateSchedule);
export const updateAdvanceSchema = advanceFieldsSchema.omit({ employeeId: true })
  .partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'يجب إرسال تعديل واحد على الأقل')
  .superRefine(validateSchedule);
export const listAdvancesQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  branchId: coercedMysqlIntSchema.optional(),
  employeeId: coercedMysqlIntSchema.optional(),
  payrollMonth: payrollMonthSchema.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).strict();

export type CreateAdvanceInput = z.infer<typeof createAdvanceSchema>;
export type UpdateAdvanceInput = z.infer<typeof updateAdvanceSchema>;
export type ListAdvancesQuery = z.infer<typeof listAdvancesQuerySchema>;
