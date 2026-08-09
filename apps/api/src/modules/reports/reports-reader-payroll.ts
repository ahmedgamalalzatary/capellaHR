import type {
  ReportFilters,
  ReportSelection,
  ReportType,
} from '@capella/contracts';
import { employees } from '@capella/database/schema';
import { asc, count } from 'drizzle-orm';

import { calendarMonthInTimeZone, type PayrollResult } from '../payroll/index.js';
import type { ReportReader } from './reports-service.js';
import {
  columns,
  employeeFilters,
  moneyCents,
  moneyFromCents,
  monthsBetween,
  payrollReportRow,
  snapshot,
  whereFrom,
  type Executor,
  type Pagination,
  type ReportsPayrollGateway,
  type Row,
} from './reports-reader-helpers.js';

export const readPayrollReport = async (
  executor: Executor,
  reportType: ReportType,
  filters: ReportFilters,
  selection: ReportSelection,
  pagination: Pagination,
  generatedAt: Date,
  deps: {
    timeZone: string;
    now: () => Date;
    payroll: ReportsPayrollGateway | undefined;
    maxInteractivePayrollCandidates: number;
  },
): ReturnType<ReportReader['read']> => {
  const { timeZone, now, payroll, maxInteractivePayrollCandidates } = deps;
  if (!payroll) return { kind: 'unavailable' };
  const currentMonth = calendarMonthInTimeZone(now(), timeZone);
  const monthFrom = filters.monthFrom ?? currentMonth;
  const monthTo = filters.monthTo ?? currentMonth;
  if (monthTo > currentMonth) return { kind: 'unavailable' };
  const reportMonths = monthsBetween(monthFrom, monthTo);
  const payrollFilters = { ...filters, branchId: undefined };
  if (pagination?.purpose === 'availability') {
    return readPayrollReport(
      executor,
      reportType,
      filters,
      { mode: 'selected', ids: [0] },
      { page: 1, pageSize: 1 },
      generatedAt,
      deps,
    );
  }
  const matchingEmployeeCount = (await executor.select({ value: count() })
    .from(employees).where(whereFrom(employeeFilters(payrollFilters, selection))))[0]?.value ?? 0;
  if (matchingEmployeeCount * reportMonths.length > maxInteractivePayrollCandidates) {
    return { kind: 'unavailable' };
  }
  const employeeRows = await executor.select({ id: employees.id, deletedAt: employees.deletedAt })
    .from(employees).where(whereFrom(employeeFilters(payrollFilters, selection)))
    .orderBy(asc(employees.employeeCode));
  const selectedRows: Array<{
    payroll: Extract<PayrollResult, { kind: 'success' }>['payroll'];
    isEmployeeDeleted: boolean;
  }> = [];
  const offset = pagination ? (pagination.page - 1) * pagination.pageSize : 0;
  const limit = pagination?.pageSize ?? Number.POSITIVE_INFINITY;
  let total = 0;
  let openRecords = 0;
  let finalizedRecords = 0;
  let totalNetSalaryCents = 0n;
  for (const month of reportMonths) {
    for (const employee of employeeRows) {
      const result = await payroll.preview(employee.id, month, executor);
      if (result.kind === 'blocked') return { kind: 'unavailable' };
      if (result.kind !== 'success') continue;
      if (filters.branchId !== undefined && result.payroll.branchId !== filters.branchId) continue;
      if (total >= offset && selectedRows.length < limit) {
        selectedRows.push({ payroll: result.payroll, isEmployeeDeleted: Boolean(employee.deletedAt) });
      }
      total += 1;
      if (result.payroll.status === 'open') openRecords += 1;
      else finalizedRecords += 1;
      totalNetSalaryCents += moneyCents(result.payroll.netSalary);
    }
  }
  const rows: Row[] = selectedRows.map(({ payroll: row, isEmployeeDeleted }) => (
    payrollReportRow(row, isEmployeeDeleted)
  ));
  return { kind: 'success', total, snapshot: snapshot(reportType, columns(
    ['id', 'الرقم'], ['employeeId', 'رقم الموظف'], ['employeeCode', 'كود الموظف'],
    ['employeeName', 'اسم الموظف'], ['branchId', 'رقم الفرع'], ['branchName', 'اسم الفرع'],
    ['payrollMonth', 'شهر الراتب'], ['status', 'الحالة'], ['baseSalary', 'الراتب الأساسي'],
    ['proratedBase', 'الراتب المستحق'], ['overtimeAmount', 'قيمة الإضافي'], ['bonusAmount', 'المكافآت'],
    ['commissionAmount', 'العمولات'],
    ['attendanceDeductionAmount', 'خصم الحضور'], ['manualDeductionAmount', 'الخصومات اليدوية'],
    ['commissionDeductionAmount', 'خصومات عمولات سابقة'],
    ['advanceAmount', 'أقساط السلف'], ['priorNegativeCarry', 'الرصيد السالب السابق'],
    ['netSalary', 'صافي الراتب'], ['eligibleWorkdays', 'أيام العمل المستحقة'],
    ['fullMonthWorkdays', 'أيام عمل الشهر'], ['requiredMinutes', 'الدقائق المطلوبة'],
    ['overtimeMinutes', 'دقائق إضافية'], ['shortageMinutes', 'دقائق النقص'],
    ['finalizedAt', 'تاريخ الاعتماد'], ['isEmployeeDeleted', 'موظف محذوف'],
  ), rows, {
    totalRecords: total,
    openRecords,
    finalizedRecords,
    totalNetSalary: moneyFromCents(totalNetSalaryCents),
  }, generatedAt) };
};
