import { z } from 'zod';

import {
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../common/index.js';
import { payrollMonthSchema } from '../payroll/index.js';
import {
  cairoDateSchema,
  weeklyDayRecordStatusSchema,
} from '../weekly-day-off/index.js';

export const selfServiceFinancialListQuerySchema = z.object({
  payrollMonth: payrollMonthSchema.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).strict();

export const selfServiceWeeklyDayListQuerySchema = z.object({
  status: weeklyDayRecordStatusSchema.optional(),
  dateFrom: cairoDateSchema.optional(),
  dateTo: cairoDateSchema.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).strict().superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({
      code: 'custom',
      path: ['dateTo'],
      message: 'تاريخ النهاية يجب ألا يسبق تاريخ البداية',
    });
  }
});

export const selfServicePayrollMonthParamsSchema = z.object({
  month: payrollMonthSchema,
}).strict();

export type SelfServiceFinancialListQuery = z.infer<typeof selfServiceFinancialListQuerySchema>;
export type SelfServiceWeeklyDayListQuery = z.infer<typeof selfServiceWeeklyDayListQuerySchema>;

