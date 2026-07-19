import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
  positiveMysqlIntSchema,
} from '../../common/index.js';
import { payrollMonthSchema } from '../payroll/index.js';

export const reportTypeSchema = z.enum([
  'branches',
  'employees',
  'devices',
  'shifts',
  'weekly-day-off',
  'attendance',
  'payroll',
  'bonuses',
  'deductions',
  'advances',
]);
export const reportExportStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed']);

const calendarDateSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, 'التاريخ غير صالح');

const normalizeIds = (value: unknown) => {
  const values = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(values)) return values;
  const entries: unknown[] = values;
  return [...new Set(entries.map((item) => typeof item === 'string' && /^\d+$/.test(item.trim())
    ? Number(item.trim()) : item))];
};
const idListSchema = z.preprocess(normalizeIds, z.array(positiveMysqlIntSchema).min(1).max(10_000));

const reportFilterShape = {
  search: z.string().trim().min(1).max(255).optional(),
  branchId: coercedMysqlIntSchema.optional(),
  dateFrom: calendarDateSchema.optional(),
  dateTo: calendarDateSchema.optional(),
  monthFrom: payrollMonthSchema.optional(),
  monthTo: payrollMonthSchema.optional(),
  deviceAssignmentType: z.enum(['employee', 'branch']).optional(),
  deviceStatus: z.enum(['active', 'revoked']).optional(),
};
const validateRanges = (
  value: {
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    monthFrom?: string | undefined;
    monthTo?: string | undefined;
  },
  context: z.RefinementCtx,
) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({ code: 'custom', path: ['dateTo'], message: 'نهاية الفترة يجب ألا تسبق بدايتها' });
  }
  if (value.monthFrom && value.monthTo && value.monthFrom > value.monthTo) {
    context.addIssue({ code: 'custom', path: ['monthTo'], message: 'نهاية فترة الرواتب يجب ألا تسبق بدايتها' });
  }
};

export const reportFiltersSchema = z.object(reportFilterShape).strict().superRefine(validateRanges);

const allowedFilters: Record<ReportType, ReadonlySet<keyof z.infer<typeof reportFiltersSchema>>> = {
  branches: new Set(['search', 'branchId', 'dateFrom', 'dateTo']),
  employees: new Set(['search', 'branchId', 'dateFrom', 'dateTo']),
  devices: new Set(['search', 'branchId', 'dateFrom', 'dateTo', 'deviceAssignmentType', 'deviceStatus']),
  shifts: new Set(['search', 'branchId', 'dateFrom', 'dateTo']),
  'weekly-day-off': new Set(['search', 'branchId', 'dateFrom', 'dateTo']),
  attendance: new Set(['search', 'branchId', 'dateFrom', 'dateTo']),
  payroll: new Set(['search', 'branchId', 'monthFrom', 'monthTo']),
  bonuses: new Set(['search', 'branchId', 'dateFrom', 'dateTo', 'monthFrom', 'monthTo']),
  deductions: new Set(['search', 'branchId', 'dateFrom', 'dateTo', 'monthFrom', 'monthTo']),
  advances: new Set(['search', 'branchId', 'dateFrom', 'dateTo', 'monthFrom', 'monthTo']),
};

const validateFilterCompatibility = (
  reportType: ReportType,
  filters: z.infer<typeof reportFiltersSchema>,
  context: z.RefinementCtx,
) => {
  for (const key of Object.keys(filters) as Array<keyof typeof filters>) {
    if (!allowedFilters[reportType].has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['filters', key],
        message: 'هذا الفلتر غير متاح لنوع التقرير المحدد',
      });
    }
  }
};

export const reportFilterCompatibilitySchema = z.object({
  reportType: reportTypeSchema,
  filters: reportFiltersSchema,
}).superRefine((value, context) => validateFilterCompatibility(value.reportType, value.filters, context));
export const reportSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z.object({ mode: z.literal('selected'), ids: idListSchema }).strict(),
]);
export const reportQuerySchema = z.object({
  ...reportFilterShape,
  selection: z.enum(['all', 'selected']).default('all'),
  selectedIds: idListSchema.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).strict().superRefine((value, context) => {
  validateRanges(value, context);
  if (value.selection === 'selected' && value.selectedIds === undefined) {
    context.addIssue({ code: 'custom', path: ['selectedIds'], message: 'يجب اختيار سجل واحد على الأقل' });
  }
  if (value.selection === 'all' && value.selectedIds !== undefined) {
    context.addIssue({ code: 'custom', path: ['selectedIds'], message: 'لا ترسل سجلات محددة مع اختيار الكل' });
  }
});
export const createReportExportSchema = z.object({
  reportType: reportTypeSchema,
  filters: reportFiltersSchema,
  selection: reportSelectionSchema,
}).strict().superRefine((value, context) => validateFilterCompatibility(value.reportType, value.filters, context));
export const reportTypeParamsSchema = z.object({ reportType: reportTypeSchema }).strict();
export const reportExportParamsSchema = z.object({ exportId: coercedMysqlIntSchema }).strict();
export const listReportExportsQuerySchema = z.object({
  reportType: reportTypeSchema.optional(),
  status: reportExportStatusSchema.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).strict();

export type ReportType = z.infer<typeof reportTypeSchema>;
export type ReportExportStatus = z.infer<typeof reportExportStatusSchema>;
export type ReportFilters = z.infer<typeof reportFiltersSchema>;
export type ReportSelection = z.infer<typeof reportSelectionSchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type CreateReportExportInput = z.infer<typeof createReportExportSchema>;
export type ListReportExportsQuery = z.infer<typeof listReportExportsQuerySchema>;

export type ReportCell = string | number | boolean | null;
export type ReportColumn = { key: string; label: string };
export type ReportSnapshot = {
  reportType: ReportType;
  title: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  summary: Record<string, ReportCell>;
};
