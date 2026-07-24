import type {
  ReportFilters,
  ReportSelection,
  ReportType,
} from '@capella/contracts';
import {
  attendanceDailyRecords,
  branches,
  devices,
  employees,
} from '@capella/database/schema';
import { and, asc, count, eq, gte, lte, or, sql, sum } from 'drizzle-orm';

import type { ReportReader } from './reports-service.js';
import {
  columns,
  dateTime,
  employeeFilters,
  endOfDate,
  paginate,
  selected,
  snapshot,
  startOfDate,
  whereFrom,
  type Executor,
  type Pagination,
} from './reports-reader-helpers.js';

export const readBranchesReport = async (
  executor: Executor,
  reportType: ReportType,
  filters: ReportFilters,
  selection: ReportSelection,
  pagination: Pagination,
  generatedAt: Date,
  deps: { timeZone: string },
): ReturnType<ReportReader['read']> => {
  const { timeZone } = deps;
  const conditions = [
    ...(filters.branchId === undefined ? [] : [eq(branches.id, filters.branchId)]),
    ...(filters.search === undefined ? [] : [or(
      sql`locate(${filters.search}, ${branches.name}) > 0`,
      sql`locate(${filters.search}, ${branches.location}) > 0`,
    )!]),
    ...(filters.dateFrom === undefined ? [] : [gte(branches.createdAt, startOfDate(filters.dateFrom, timeZone))]),
    ...(filters.dateTo === undefined ? [] : [lte(branches.createdAt, endOfDate(filters.dateTo, timeZone))]),
    ...selected(selection, branches.id),
  ];
  const where = whereFrom(conditions);
  const query = executor.select({
    id: branches.id,
    name: branches.name,
    location: branches.location,
    latitude: branches.latitude,
    longitude: branches.longitude,
    gpsAccuracyMeters: branches.gpsAccuracyMeters,
    attendanceRadiusMeters: branches.attendanceRadiusMeters,
    hasEverBeenReferenced: branches.hasEverBeenReferenced,
    createdAt: branches.createdAt,
    updatedAt: branches.updatedAt,
  }).from(branches).where(where).orderBy(asc(branches.id));
  const [records, totals] = await Promise.all([
    paginate(query, pagination),
    executor.select({ value: count() }).from(branches).where(where),
  ]);
  const total = totals[0]?.value ?? 0;
  const rows = records.map((row) => ({ ...row, createdAt: dateTime(row.createdAt), updatedAt: dateTime(row.updatedAt) }));
  return { kind: 'success', total, snapshot: snapshot(reportType, columns(
    ['id', 'الرقم'], ['name', 'الاسم'], ['location', 'الموقع'], ['latitude', 'خط العرض'],
    ['longitude', 'خط الطول'], ['gpsAccuracyMeters', 'دقة GPS بالمتر'],
    ['attendanceRadiusMeters', 'نطاق الحضور بالمتر'], ['hasEverBeenReferenced', 'مرتبط بسجلات'],
    ['createdAt', 'تاريخ الإنشاء'], ['updatedAt', 'آخر تحديث'],
  ), rows, { totalRecords: total }, generatedAt) };
};

export const readEmployeesOrShiftsReport = async (
  executor: Executor,
  reportType: ReportType,
  filters: ReportFilters,
  selection: ReportSelection,
  pagination: Pagination,
  generatedAt: Date,
  deps: { timeZone: string },
): ReturnType<ReportReader['read']> => {
  const { timeZone } = deps;
  const conditions = employeeFilters(filters, selection);
  if (filters.dateFrom) conditions.push(gte(employees.createdAt, startOfDate(filters.dateFrom, timeZone)));
  if (filters.dateTo) conditions.push(lte(employees.createdAt, endOfDate(filters.dateTo, timeZone)));
  const where = whereFrom(conditions);
  const query = executor.select({
    id: employees.id,
    employeeCode: employees.employeeCode,
    fullName: employees.fullName,
    personalPhone: employees.personalPhone,
    whatsappPhone: employees.whatsappPhone,
    age: employees.age,
    address: employees.address,
    branchId: employees.branchId,
    branchName: branches.name,
    shiftDurationMinutes: employees.shiftDurationMinutes,
    monthlyBaseSalary: employees.monthlyBaseSalary,
    deletedAt: employees.deletedAt,
    createdAt: employees.createdAt,
    updatedAt: employees.updatedAt,
  }).from(employees).innerJoin(branches, eq(branches.id, employees.branchId))
    .where(where).orderBy(asc(employees.employeeCode));
  const [records, totals] = await Promise.all([
    paginate(query, pagination),
    executor.select({ value: count() }).from(employees).where(where),
  ]);
  const total = totals[0]?.value ?? 0;
  if (reportType === 'shifts') {
    const rows = records.map((row) => ({
      employeeId: row.id,
      employeeCode: row.employeeCode,
      employeeName: row.fullName,
      branchId: row.branchId,
      branchName: row.branchName,
      durationMinutes: row.shiftDurationMinutes,
      isDeleted: Boolean(row.deletedAt),
      updatedAt: dateTime(row.updatedAt),
    }));
    const aggregate = (await executor.select({ average: sql<number>`avg(${employees.shiftDurationMinutes})` })
      .from(employees).where(where))[0];
    return { kind: 'success', total, snapshot: snapshot(reportType, columns(
      ['employeeId', 'رقم الموظف'], ['employeeCode', 'كود الموظف'], ['employeeName', 'اسم الموظف'],
      ['branchId', 'رقم الفرع'], ['branchName', 'اسم الفرع'], ['durationMinutes', 'مدة الوردية بالدقائق'],
      ['isDeleted', 'موظف محذوف'], ['updatedAt', 'آخر تحديث'],
    ), rows, { totalRecords: total, averageDurationMinutes: aggregate?.average ?? 0 }, generatedAt) };
  }
  const rows = records.map((row) => ({
    id: row.id,
    employeeCode: row.employeeCode,
    fullName: row.fullName,
    personalPhone: row.personalPhone,
    whatsappPhone: row.whatsappPhone,
    age: row.age,
    address: row.address,
    branchId: row.branchId,
    branchName: row.branchName,
    shiftDurationMinutes: row.shiftDurationMinutes,
    monthlyBaseSalary: row.monthlyBaseSalary,
    isDeleted: Boolean(row.deletedAt),
    deletedAt: dateTime(row.deletedAt),
    createdAt: dateTime(row.createdAt),
    updatedAt: dateTime(row.updatedAt),
  }));
  const deleted = (await executor.select({ value: count() }).from(employees)
    .where(and(where, sql`${employees.deletedAt} is not null`)))[0]?.value ?? 0;
  return { kind: 'success', total, snapshot: snapshot(reportType, columns(
    ['id', 'الرقم'], ['employeeCode', 'كود الموظف'], ['fullName', 'الاسم'],
    ['personalPhone', 'الهاتف الشخصي'], ['whatsappPhone', 'هاتف واتساب'], ['age', 'العمر'],
    ['address', 'العنوان'], ['branchId', 'رقم الفرع'], ['branchName', 'اسم الفرع'],
    ['shiftDurationMinutes', 'مدة الوردية بالدقائق'], ['monthlyBaseSalary', 'الراتب الأساسي'],
    ['isDeleted', 'موظف محذوف'], ['deletedAt', 'تاريخ الحذف'], ['createdAt', 'تاريخ الإنشاء'],
    ['updatedAt', 'آخر تحديث'],
  ), rows, { totalRecords: total, activeRecords: total - deleted, deletedRecords: deleted }, generatedAt) };
};

export const readDevicesReport = async (
  executor: Executor,
  reportType: ReportType,
  filters: ReportFilters,
  selection: ReportSelection,
  pagination: Pagination,
  generatedAt: Date,
  deps: { timeZone: string },
): ReturnType<ReportReader['read']> => {
  const { timeZone } = deps;
  const conditions = [
    ...(filters.branchId === undefined ? [] : [or(
      eq(devices.branchId, filters.branchId), eq(employees.branchId, filters.branchId),
    )!]),
    ...(filters.deviceAssignmentType === undefined ? [] : [eq(devices.assignmentType, filters.deviceAssignmentType)]),
    ...(filters.deviceStatus === undefined ? [] : [eq(devices.status, filters.deviceStatus)]),
    ...(filters.search === undefined ? [] : [or(
      sql`locate(${filters.search}, ${employees.fullName}) > 0`,
      sql`locate(${filters.search}, cast(${employees.employeeCode} as char)) > 0`,
      sql`locate(${filters.search}, ${branches.name}) > 0`,
      sql`locate(${filters.search}, ${devices.browser}) > 0`,
      sql`locate(${filters.search}, ${devices.platform}) > 0`,
    )!]),
    ...(filters.dateFrom === undefined ? [] : [gte(devices.pairedAt, startOfDate(filters.dateFrom, timeZone))]),
    ...(filters.dateTo === undefined ? [] : [lte(devices.pairedAt, endOfDate(filters.dateTo, timeZone))]),
    ...selected(selection, devices.id),
  ];
  const where = whereFrom(conditions);
  const query = executor.select({
    id: devices.id,
    assignmentType: devices.assignmentType,
    employeeId: devices.employeeId,
    employeeCode: employees.employeeCode,
    employeeName: employees.fullName,
    branchId: sql<number | null>`coalesce(${devices.branchId}, ${employees.branchId})`,
    branchName: branches.name,
    browser: devices.browser,
    platform: devices.platform,
    status: devices.status,
    pairedAt: devices.pairedAt,
    lastUsedAt: devices.lastUsedAt,
    revokedAt: devices.revokedAt,
  }).from(devices)
    .leftJoin(employees, eq(employees.id, devices.employeeId))
    .leftJoin(branches, or(eq(branches.id, devices.branchId), eq(branches.id, employees.branchId)))
    .where(where).orderBy(asc(devices.id));
  const [records, totals, active] = await Promise.all([
    paginate(query, pagination),
    executor.select({ value: count() }).from(devices)
      .leftJoin(employees, eq(employees.id, devices.employeeId))
      .leftJoin(branches, or(eq(branches.id, devices.branchId), eq(branches.id, employees.branchId)))
      .where(where),
    executor.select({ value: count() }).from(devices)
      .leftJoin(employees, eq(employees.id, devices.employeeId))
      .leftJoin(branches, or(eq(branches.id, devices.branchId), eq(branches.id, employees.branchId)))
      .where(and(where, eq(devices.status, 'active'))),
  ]);
  const total = totals[0]?.value ?? 0;
  const activeCount = active[0]?.value ?? 0;
  const rows = records.map((row) => ({
    ...row,
    pairedAt: dateTime(row.pairedAt),
    lastUsedAt: dateTime(row.lastUsedAt),
    revokedAt: dateTime(row.revokedAt),
  }));
  return { kind: 'success', total, snapshot: snapshot(reportType, columns(
    ['id', 'الرقم'], ['assignmentType', 'نوع التعيين'], ['employeeId', 'رقم الموظف'],
    ['employeeCode', 'كود الموظف'], ['employeeName', 'اسم الموظف'], ['branchId', 'رقم الفرع'],
    ['branchName', 'اسم الفرع'], ['browser', 'المتصفح'], ['platform', 'النظام'],
    ['status', 'الحالة'], ['pairedAt', 'تاريخ الربط'], ['lastUsedAt', 'آخر استخدام'], ['revokedAt', 'تاريخ الإلغاء'],
  ), rows, { totalRecords: total, activeRecords: activeCount, revokedRecords: total - activeCount }, generatedAt) };
};

export const readWeeklyDayOffReport = async (
  executor: Executor,
  reportType: ReportType,
  filters: ReportFilters,
  selection: ReportSelection,
  pagination: Pagination,
  generatedAt: Date,
): ReturnType<ReportReader['read']> => {
  const historicalBranchId = sql<number>`coalesce(${attendanceDailyRecords.branchId}, ${employees.branchId})`;
  const conditions = [
    eq(attendanceDailyRecords.status, 'weekly_day_off'),
    ...employeeFilters(filters, selection, historicalBranchId),
    ...(filters.dateFrom === undefined ? [] : [gte(attendanceDailyRecords.attendanceDate, filters.dateFrom)]),
    ...(filters.dateTo === undefined ? [] : [lte(attendanceDailyRecords.attendanceDate, filters.dateTo)]),
  ];
  const where = whereFrom(conditions);
  const query = executor.select({
    id: attendanceDailyRecords.id,
    employeeId: employees.id,
    employeeCode: employees.employeeCode,
    employeeName: employees.fullName,
    branchId: historicalBranchId,
    branchName: branches.name,
    attendanceDate: attendanceDailyRecords.attendanceDate,
    requiredMinutes: attendanceDailyRecords.absenceRequiredMinutes,
    convertedAt: attendanceDailyRecords.dayOffConvertedAt,
    employeeDeletedAt: employees.deletedAt,
  }).from(attendanceDailyRecords)
    .innerJoin(employees, eq(employees.id, attendanceDailyRecords.employeeId))
    .innerJoin(branches, eq(branches.id, historicalBranchId))
    .where(where).orderBy(asc(attendanceDailyRecords.attendanceDate), asc(employees.employeeCode));
  const [records, aggregate] = await Promise.all([
    paginate(query, pagination),
    executor.select({ value: count(), minutes: sum(attendanceDailyRecords.absenceRequiredMinutes) })
      .from(attendanceDailyRecords).innerJoin(employees, eq(employees.id, attendanceDailyRecords.employeeId))
      .where(where),
  ]);
  const total = aggregate[0]?.value ?? 0;
  const rows = records.map((row) => ({
    ...row,
    isEmployeeDeleted: Boolean(row.employeeDeletedAt),
    employeeDeletedAt: dateTime(row.employeeDeletedAt),
    convertedAt: dateTime(row.convertedAt),
  }));
  return { kind: 'success', total, snapshot: snapshot(reportType, columns(
    ['id', 'الرقم'], ['employeeId', 'رقم الموظف'], ['employeeCode', 'كود الموظف'],
    ['employeeName', 'اسم الموظف'], ['branchId', 'رقم الفرع'], ['branchName', 'اسم الفرع'],
    ['attendanceDate', 'تاريخ يوم الراحة'], ['requiredMinutes', 'دقائق العمل المعفاة'],
    ['convertedAt', 'تاريخ التحويل'], ['isEmployeeDeleted', 'موظف محذوف'],
  ), rows, { totalRecords: total, totalRequiredMinutes: Number(aggregate[0]?.minutes ?? 0) }, generatedAt) };
};
