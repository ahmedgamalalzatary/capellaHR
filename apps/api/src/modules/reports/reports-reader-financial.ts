import type {
  ReportFilters,
  ReportSelection,
  ReportType,
} from '@capella/contracts';
import {
  advanceInstallments,
  advances,
  bonuses,
  branches,
  deductions,
  employeeBranchAssignments,
  employees,
} from '@capella/database/schema';
import { and, asc, count, eq, exists, gt, gte, inArray, isNull, lte, or, sql, sum } from 'drizzle-orm';

import type { ReportReader } from './reports-service.js';
import {
  columns,
  dateTime,
  employeeFilters,
  endOfDate,
  monthStart,
  paginate,
  snapshot,
  startOfDate,
  whereFrom,
  type Executor,
  type Pagination,
} from './reports-reader-helpers.js';

export const readBonusesOrDeductionsReport = async (
  executor: Executor,
  reportType: ReportType,
  filters: ReportFilters,
  selection: ReportSelection,
  pagination: Pagination,
  generatedAt: Date,
  deps: { timeZone: string },
): ReturnType<ReportReader['read']> => {
  const { timeZone } = deps;
  const table = reportType === 'bonuses' ? bonuses : deductions;
  const reason = reportType === 'bonuses' ? bonuses.reason : sql<null>`null`;
  const historicalBranchId = sql<number>`coalesce(${employeeBranchAssignments.branchId}, ${employees.branchId})`;
  const assignmentAtCreation = and(
    eq(employeeBranchAssignments.employeeId, table.employeeId),
    lte(employeeBranchAssignments.effectiveFrom, table.createdAt),
    or(isNull(employeeBranchAssignments.effectiveTo), gt(employeeBranchAssignments.effectiveTo, table.createdAt)),
  );
  const conditions = [
    ...employeeFilters(filters, selection, historicalBranchId),
    ...(filters.monthFrom === undefined ? [] : [gte(table.payrollMonth, monthStart(filters.monthFrom))]),
    ...(filters.monthTo === undefined ? [] : [lte(table.payrollMonth, monthStart(filters.monthTo))]),
    ...(filters.dateFrom === undefined ? [] : [gte(table.createdAt, startOfDate(filters.dateFrom, timeZone))]),
    ...(filters.dateTo === undefined ? [] : [lte(table.createdAt, endOfDate(filters.dateTo, timeZone))]),
  ];
  const where = whereFrom(conditions);
  const query = executor.select({
    id: table.id,
    employeeId: employees.id,
    employeeCode: employees.employeeCode,
    employeeName: employees.fullName,
    branchId: historicalBranchId,
    branchName: branches.name,
    payrollMonth: table.payrollMonth,
    amount: table.amount,
    reason,
    employeeDeletedAt: employees.deletedAt,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
  }).from(table).innerJoin(employees, eq(employees.id, table.employeeId))
    .leftJoin(employeeBranchAssignments, assignmentAtCreation)
    .innerJoin(branches, eq(branches.id, historicalBranchId))
    .where(where).orderBy(asc(table.payrollMonth), asc(table.id));
  const [records, aggregate] = await Promise.all([
    paginate(query, pagination),
    executor.select({ value: count(), amount: sum(table.amount) }).from(table)
      .innerJoin(employees, eq(employees.id, table.employeeId))
      .leftJoin(employeeBranchAssignments, assignmentAtCreation).where(where),
  ]);
  const total = aggregate[0]?.value ?? 0;
  const rows = records.map(({ reason: rowReason, ...row }) => ({
    ...row,
    ...(reportType === 'bonuses' ? { reason: rowReason } : {}),
    payrollMonth: row.payrollMonth.slice(0, 7),
    amount: row.amount,
    isEmployeeDeleted: Boolean(row.employeeDeletedAt),
    employeeDeletedAt: dateTime(row.employeeDeletedAt),
    createdAt: dateTime(row.createdAt),
    updatedAt: dateTime(row.updatedAt),
  }));
  return { kind: 'success', total, snapshot: snapshot(reportType, columns(
    ['id', 'الرقم'], ['employeeId', 'رقم الموظف'], ['employeeCode', 'كود الموظف'],
    ['employeeName', 'اسم الموظف'], ['branchId', 'رقم الفرع'], ['branchName', 'اسم الفرع'],
    ['payrollMonth', 'شهر الراتب'], ['amount', 'المبلغ'],
    ...(reportType === 'bonuses' ? [['reason', 'سبب المكافأة'] as [string, string]] : []),
    ['isEmployeeDeleted', 'موظف محذوف'],
    ['createdAt', 'تاريخ الإنشاء'], ['updatedAt', 'آخر تحديث'],
  ), rows, { totalRecords: total, totalAmount: aggregate[0]?.amount ?? '0.00' }, generatedAt) };
};

export const readAdvancesReport = async (
  executor: Executor,
  reportType: ReportType,
  filters: ReportFilters,
  selection: ReportSelection,
  pagination: Pagination,
  generatedAt: Date,
  deps: { timeZone: string },
): ReturnType<ReportReader['read']> => {
  const { timeZone } = deps;
  const historicalBranchId = sql<number>`coalesce(${employeeBranchAssignments.branchId}, ${employees.branchId})`;
  const assignmentAtCreation = and(
    eq(employeeBranchAssignments.employeeId, advances.employeeId),
    lte(employeeBranchAssignments.effectiveFrom, advances.createdAt),
    or(isNull(employeeBranchAssignments.effectiveTo), gt(employeeBranchAssignments.effectiveTo, advances.createdAt)),
  );
  const conditions = [
    ...employeeFilters(filters, selection, historicalBranchId),
    ...(filters.monthFrom === undefined && filters.monthTo === undefined ? [] : [exists(
      executor.select({ id: advanceInstallments.id }).from(advanceInstallments).where(and(
        eq(advanceInstallments.advanceId, advances.id),
        ...(filters.monthFrom === undefined ? [] : [gte(advanceInstallments.payrollMonth, monthStart(filters.monthFrom))]),
        ...(filters.monthTo === undefined ? [] : [lte(advanceInstallments.payrollMonth, monthStart(filters.monthTo))]),
      )),
    )]),
    ...(filters.dateFrom === undefined ? [] : [gte(advances.createdAt, startOfDate(filters.dateFrom, timeZone))]),
    ...(filters.dateTo === undefined ? [] : [lte(advances.createdAt, endOfDate(filters.dateTo, timeZone))]),
  ];
  const where = whereFrom(conditions);
  const query = executor.select({
    id: advances.id,
    employeeId: employees.id,
    employeeCode: employees.employeeCode,
    employeeName: employees.fullName,
    branchId: historicalBranchId,
    branchName: branches.name,
    amount: advances.amount,
    installmentCount: advances.installmentCount,
    startMonth: advances.startMonth,
    employeeDeletedAt: employees.deletedAt,
    createdAt: advances.createdAt,
    updatedAt: advances.updatedAt,
  }).from(advances).innerJoin(employees, eq(employees.id, advances.employeeId))
    .leftJoin(employeeBranchAssignments, assignmentAtCreation)
    .innerJoin(branches, eq(branches.id, historicalBranchId))
    .where(where).orderBy(asc(advances.startMonth), asc(advances.id));
  const [records, aggregate] = await Promise.all([
    paginate(query, pagination),
    executor.select({ value: count(), amount: sum(advances.amount) }).from(advances)
      .innerJoin(employees, eq(employees.id, advances.employeeId))
      .leftJoin(employeeBranchAssignments, assignmentAtCreation).where(where),
  ]);
  const recordIds = records.map(({ id }) => id);
  const installments = recordIds.length ? await executor.select({
    advanceId: advanceInstallments.advanceId,
    ordinal: advanceInstallments.ordinal,
    payrollMonth: advanceInstallments.payrollMonth,
    amount: advanceInstallments.amount,
  }).from(advanceInstallments).where(inArray(advanceInstallments.advanceId, recordIds))
    .orderBy(asc(advanceInstallments.advanceId), asc(advanceInstallments.ordinal)) : [];
  const schedules = new Map<number, string[]>();
  for (const installment of installments) {
    const schedule = schedules.get(installment.advanceId) ?? [];
    schedule.push(`${installment.payrollMonth.slice(0, 7)}: ${installment.amount}`);
    schedules.set(installment.advanceId, schedule);
  }
  const total = aggregate[0]?.value ?? 0;
  const rows = records.map((row) => ({
    ...row,
    amount: row.amount,
    startMonth: row.startMonth.slice(0, 7),
    installmentSchedule: (schedules.get(row.id) ?? []).join(' | '),
    isEmployeeDeleted: Boolean(row.employeeDeletedAt),
    employeeDeletedAt: dateTime(row.employeeDeletedAt),
    createdAt: dateTime(row.createdAt),
    updatedAt: dateTime(row.updatedAt),
  }));
  return { kind: 'success', total, snapshot: snapshot(reportType, columns(
    ['id', 'الرقم'], ['employeeId', 'رقم الموظف'], ['employeeCode', 'كود الموظف'],
    ['employeeName', 'اسم الموظف'], ['branchId', 'رقم الفرع'], ['branchName', 'اسم الفرع'],
    ['amount', 'المبلغ'], ['installmentCount', 'عدد الأقساط'], ['startMonth', 'شهر البداية'],
    ['installmentSchedule', 'جدول الأقساط'], ['isEmployeeDeleted', 'موظف محذوف'],
    ['createdAt', 'تاريخ الإنشاء'], ['updatedAt', 'آخر تحديث'],
  ), rows, { totalRecords: total, totalAmount: aggregate[0]?.amount ?? '0.00' }, generatedAt) };
};
