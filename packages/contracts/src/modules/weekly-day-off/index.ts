import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../common/index.js';

const isCalendarDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month! - 1
    && date.getUTCDate() === day;
};

export const cairoDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD')
  .refine(isCalendarDate, 'التاريخ غير صالح');

export const weeklyDayRecordStatusSchema = z.enum(['absence', 'weekly_day_off']);

export const weeklyDayRecordParamsSchema = z.object({
  recordId: coercedMysqlIntSchema,
});

export const listWeeklyDayRecordsQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  employeeId: coercedMysqlIntSchema.optional(),
  branchId: coercedMysqlIntSchema.optional(),
  status: weeklyDayRecordStatusSchema.optional(),
  dateFrom: cairoDateSchema.optional(),
  dateTo: cairoDateSchema.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({
      code: 'custom',
      path: ['dateTo'],
      message: 'تاريخ النهاية يجب ألا يسبق تاريخ البداية',
    });
  }
});

export type WeeklyDayRecordStatus = z.infer<typeof weeklyDayRecordStatusSchema>;
export type ListWeeklyDayRecordsQuery = z.infer<typeof listWeeklyDayRecordsQuerySchema>;
