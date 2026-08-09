import type {
  ReportCell,
  ReportColumn,
  ReportFilters,
  ReportSelection,
  ReportSnapshot,
  ReportType,
} from '@capella/contracts';
import { employees } from '@capella/database/schema';
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '../payroll/financial-repository-helpers.js';
import type { PayrollResult } from '../payroll/index.js';

export type Pagination = { page: number; pageSize: number; purpose?: 'screen' | 'availability' } | null;
export type Row = Record<string, ReportCell>;
export type Executor = Parameters<Parameters<Database['transaction']>[0]>[0];
export const snapshotTransactionConfig = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
} as const;
const titles: Record<ReportType, string> = {
  branches: 'تقرير الفروع',
  employees: 'تقرير الموظفين',
  devices: 'تقرير الأجهزة',
  shifts: 'تقرير الورديات',
  'weekly-day-off': 'تقرير أيام الراحة الأسبوعية',
  attendance: 'تقرير الحضور والغياب',
  payroll: 'تقرير الرواتب',
  bonuses: 'تقرير المكافآت',
  deductions: 'تقرير الخصومات',
  advances: 'تقرير السلف',
};

export const columns = (...entries: Array<[string, string]>): ReportColumn[] => entries.map(([key, label]) => ({ key, label }));
export const whereFrom = (filters: SQL[]) => filters.length ? and(...filters) : undefined;
export const dateTime = (value: Date | null) => value?.toISOString() ?? null;
export const monthStart = (value: string) => `${value}-01`;
const dateAt = (instant: Date, formatter: Intl.DateTimeFormat) => {
  const parts = Object.fromEntries(formatter
    .formatToParts(instant).filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
export const startOfDate = (value: string, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(year, month - 1, day);
  let low = target - 36 * 60 * 60 * 1_000;
  let high = target + 36 * 60 * 60 * 1_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateAt(new Date(middle), formatter) < value) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
};
export const endOfDate = (value: string, timeZone: string) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return new Date(startOfDate(nextDate, timeZone).valueOf() - 1);
};
export const selected = (selection: ReportSelection, column: Parameters<typeof inArray>[0]): SQL[] =>
  selection.mode === 'selected' ? [inArray(column, selection.ids)] : [];
export const searchEmployee = (search: string) => or(
  sql`locate(${search}, ${employees.fullName}) > 0`,
  sql`locate(${search}, cast(${employees.employeeCode} as char)) > 0`,
  sql`locate(${search}, ${employees.personalPhone}) > 0`,
  sql`locate(${search}, ${employees.whatsappPhone}) > 0`,
)!;
export const employeeFilters = (filters: ReportFilters, selection: ReportSelection, branchId: SQL = sql`${employees.branchId}`): SQL[] => [
  ...(filters.branchId === undefined ? [] : [eq(branchId, filters.branchId)]),
  ...(filters.search === undefined ? [] : [searchEmployee(filters.search)]),
  ...selected(selection, employees.id),
];
export const paginate = <T>(query: { limit(value: number): { offset(value: number): Promise<T[]> } }, pagination: Pagination) =>
  pagination ? query.limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize) : query as unknown as Promise<T[]>;
export const snapshot = (
  reportType: ReportType,
  reportColumns: ReportColumn[],
  rows: Row[],
  summary: Record<string, ReportCell>,
  generatedAt: Date,
): ReportSnapshot => ({
  reportType,
  title: titles[reportType],
  generatedAt: generatedAt.toISOString(),
  columns: reportColumns,
  rows,
  summary,
});

export interface ReportsPayrollGateway {
  preview(
    employeeId: number,
    month: string,
    context: Executor,
  ): Promise<PayrollResult>;
}
export const monthsBetween = (from: string, to: string) => {
  const months: string[] = [];
  let [year, month] = from.split('-').map(Number) as [number, number];
  while (`${year}-${String(month).padStart(2, '0')}` <= to) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    if (month === 12) {
      year += 1;
      month = 1;
    } else month += 1;
  }
  return months;
};
export const moneyCents = (value: string) => {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
};
export const moneyFromCents = (value: bigint) => {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const formatted = `${unsigned / 100n}.${String(unsigned % 100n).padStart(2, '0')}`;
  return negative ? `-${formatted}` : formatted;
};
export type SuccessfulPayroll = Extract<PayrollResult, { kind: 'success' }>['payroll'];
export const payrollReportRow = (row: SuccessfulPayroll, isEmployeeDeleted: boolean): Row => ({
  id: row.id || null,
  employeeId: row.employeeId,
  employeeCode: row.employeeCode,
  employeeName: row.employeeName,
  branchId: row.branchId,
  branchName: row.branchName,
  payrollMonth: row.payrollMonth,
  status: row.status,
  baseSalary: row.baseSalary,
  proratedBase: row.proratedBase,
  overtimeAmount: row.overtimeAmount,
  bonusAmount: row.bonusAmount,
  commissionAmount: row.commissionAmount,
  attendanceDeductionAmount: row.attendanceDeductionAmount,
  manualDeductionAmount: row.manualDeductionAmount,
  commissionDeductionAmount: row.commissionDeductionAmount,
  advanceAmount: row.advanceAmount,
  priorNegativeCarry: row.priorNegativeCarry,
  netSalary: row.netSalary,
  eligibleWorkdays: row.eligibleWorkdays,
  fullMonthWorkdays: row.fullMonthWorkdays,
  requiredMinutes: row.requiredMinutes,
  overtimeMinutes: row.overtimeMinutes,
  shortageMinutes: row.shortageMinutes,
  finalizedAt: dateTime(row.finalizedAt),
  isEmployeeDeleted,
});
