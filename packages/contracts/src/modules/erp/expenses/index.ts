import { z } from 'zod';

import { coercedMysqlIntSchema, paginationPageSchema, paginationPageSizeSchema } from '../../../common/index.js';

const cairoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح').refine((value) => {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = value.split('-').map(Number);
  if (year < 1000 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'التاريخ غير صالح');
const amountSchema = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'المبلغ غير صالح').transform((value, context) => {
  const [whole = '', fraction = ''] = value.split('.');
  const normalized = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
  if (Number(normalized) <= 0) {
    context.addIssue({ code: 'custom', message: 'المبلغ يجب أن يكون أكبر من صفر' });
    return z.NEVER;
  }
  return normalized;
});
/** An expense is identified by its own name; the notes are free extra detail. */
const nameSchema = z.string().trim().min(1, 'اسم المصروف مطلوب').max(255, 'اسم المصروف طويل جدًا');
const descriptionSchema = z.string().trim().max(1000, 'الوصف طويل جدًا');
const branchScope = { branchId: coercedMysqlIntSchema.optional() };
const expenseFields = {
  name: nameSchema,
  amount: amountSchema,
  expenseDate: cairoDateSchema,
  description: descriptionSchema.optional(),
  ...branchScope,
};

export const createExpenseSchema = z.object(expenseFields).strict();
export const correctExpenseSchema = z.object({
  ...expenseFields,
  reason: z.string().trim().min(1, 'سبب التصحيح مطلوب').max(500, 'سبب التصحيح طويل جدًا'),
}).strict();
export const expenseIdParamsSchema = z.object({ id: coercedMysqlIntSchema }).strict();
export const expenseBranchQuerySchema = z.object(branchScope).strict();
export const listExpensesQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  fromDate: cairoDateSchema.optional(),
  toDate: cairoDateSchema.optional(),
  status: z.enum(['active', 'corrected']).optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  ...branchScope,
}).strict().refine((value) => !value.fromDate || !value.toDate || value.fromDate <= value.toDate, {
  path: ['toDate'], message: 'نهاية الفترة يجب ألا تسبق بدايتها',
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type CorrectExpenseInput = z.infer<typeof correctExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
