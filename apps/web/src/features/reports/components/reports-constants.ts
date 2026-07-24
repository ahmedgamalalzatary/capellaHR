import type { ReportCell, ReportType } from '@capella/contracts';

import { ApiError } from '@/lib/api/client';

import type { ReportExport } from '../api/reports-api';

export const REPORT_TABS: Array<{ type: ReportType; label: string }> = [
  { type: 'branches', label: 'الفروع' },
  { type: 'employees', label: 'الموظفون' },
  { type: 'devices', label: 'الأجهزة' },
  { type: 'shifts', label: 'الورديات' },
  { type: 'weekly-day-off', label: 'أيام الراحة' },
  { type: 'attendance', label: 'الحضور والغياب' },
  { type: 'payroll', label: 'الرواتب' },
  { type: 'bonuses', label: 'المكافآت' },
  { type: 'deductions', label: 'الخصومات' },
  { type: 'advances', label: 'السلف' },
];

const TAB_LABELS = Object.fromEntries(REPORT_TABS.map((tab) => [tab.type, tab.label])) as Record<
  ReportType,
  string
>;

/** Mirrors the locked per-tab filter compatibility from the contracts package. */
export const MONTH_RANGE_TABS: ReadonlySet<ReportType> = new Set([
  'payroll',
  'bonuses',
  'deductions',
  'advances',
]);
export const DATE_RANGE_TABS: ReadonlySet<ReportType> = new Set([
  'branches',
  'employees',
  'devices',
  'shifts',
  'weekly-day-off',
  'attendance',
  'bonuses',
  'deductions',
  'advances',
]);

/** Employee-related report selection always targets employees, not transient row ids. */
export const EMPLOYEE_SCOPED_TABS: ReadonlySet<ReportType> = new Set([
  'shifts',
  'weekly-day-off',
  'attendance',
  'payroll',
  'bonuses',
  'deductions',
  'advances',
]);
export const idKeyOf = (reportType: ReportType) => EMPLOYEE_SCOPED_TABS.has(reportType) ? 'employeeId' : 'id';
export const rowKeyOf = (reportType: ReportType, row: Record<string, unknown>, index: number) => [
  reportType,
  row.recordType,
  row.id,
  row.employeeId,
  row.attendanceDate,
  row.payrollMonth,
  index,
].map((value) => String(value ?? '')).join(':');

export const SUMMARY_LABELS: Record<string, string> = {
  totalRecords: 'إجمالي السجلات',
  activeRecords: 'سجلات نشطة',
  deletedRecords: 'سجلات محذوفة',
  revokedRecords: 'سجلات ملغاة',
  averageDurationMinutes: 'متوسط مدة الوردية بالدقائق',
  totalRequiredMinutes: 'إجمالي الدقائق المطلوبة',
  totalAmount: 'إجمالي المبلغ (ج.م)',
  attendanceRecords: 'سجلات الحضور',
  absenceRecords: 'سجلات الغياب',
  weeklyDayOffRecords: 'أيام الراحة الأسبوعية',
  totalWorkedMinutes: 'إجمالي دقائق العمل',
  totalOvertimeMinutes: 'إجمالي الدقائق الإضافية',
  totalShortageMinutes: 'إجمالي دقائق النقص',
  openRecords: 'رواتب مفتوحة',
  finalizedRecords: 'رواتب معتمدة',
  totalNetSalary: 'إجمالي صافي الرواتب (ج.م)',
};

type ExportStatusBadge = { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' };

const EXPORT_STATUS: Record<ReportExport['status'], ExportStatusBadge> = {
  queued: { label: 'في الانتظار', variant: 'neutral' },
  processing: { label: 'قيد المعالجة', variant: 'warning' },
  completed: { label: 'مكتمل', variant: 'success' },
  failed: { label: 'فشل', variant: 'danger' },
};

/** The server may add statuses and report types this client does not know yet. */
export const exportStatusBadge = (status: string): ExportStatusBadge =>
  (EXPORT_STATUS as Partial<Record<string, ExportStatusBadge>>)[status]
  ?? { label: status, variant: 'neutral' };

export const tabLabel = (reportType: string): string =>
  (TAB_LABELS as Partial<Record<string, string>>)[reportType] ?? reportType;

export const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) return error.message;
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

export const cellText = (value: ReportCell): string => {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'string') return ({
    open: 'مفتوح',
    finalized: 'معتمد',
    attendance: 'حضور',
    absence: 'غياب',
    weekly_day_off: 'راحة أسبوعية',
    daily_record: 'سجل يومي',
    active: 'نشط',
    revoked: 'ملغى',
    employee: 'موظف',
    branch: 'فرع',
  } as Record<string, string>)[value] ?? value;
  return String(value);
};
