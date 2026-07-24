import type {
  ReportFilters,
  ReportSelection,
  ReportType,
} from '@capella/contracts';
import {
  attendanceDailyRecords,
  attendanceSessions,
  branches,
  employees,
} from '@capella/database/schema';
import { asc, count, eq, gte, lte, ne, sql, sum } from 'drizzle-orm';

import type { ReportReader } from './reports-service.js';
import {
  columns,
  dateTime,
  employeeFilters,
  snapshot,
  whereFrom,
  type Executor,
  type Pagination,
  type Row,
} from './reports-reader-helpers.js';

export const readAttendanceReport = async (
  executor: Executor,
  reportType: ReportType,
  filters: ReportFilters,
  selection: ReportSelection,
  pagination: Pagination,
  generatedAt: Date,
): ReturnType<ReportReader['read']> => {
  const sessionBranchId = sql<number>`coalesce(${attendanceSessions.branchId}, ${employees.branchId})`;
  const dailyBranchId = sql<number>`coalesce(${attendanceDailyRecords.branchId}, ${employees.branchId})`;
  const sessionWhere = whereFrom([
    ...employeeFilters(filters, selection, sessionBranchId),
    ...(filters.dateFrom === undefined ? [] : [gte(attendanceSessions.attendanceDate, filters.dateFrom)]),
    ...(filters.dateTo === undefined ? [] : [lte(attendanceSessions.attendanceDate, filters.dateTo)]),
  ]);
  const dailyWhere = whereFrom([
    ...employeeFilters(filters, selection, dailyBranchId),
    ne(attendanceDailyRecords.status, 'attendance_replaced'),
    ...(filters.dateFrom === undefined ? [] : [gte(attendanceDailyRecords.attendanceDate, filters.dateFrom)]),
    ...(filters.dateTo === undefined ? [] : [lte(attendanceDailyRecords.attendanceDate, filters.dateTo)]),
  ]);
  const sessionQuery = executor.select({
    id: attendanceSessions.id,
    employeeId: employees.id,
    employeeCode: employees.employeeCode,
    employeeName: employees.fullName,
    branchId: sessionBranchId,
    branchName: branches.name,
    attendanceDate: attendanceSessions.attendanceDate,
    requiredMinutes: attendanceSessions.requiredMinutes,
    checkInAt: attendanceSessions.checkInAt,
    checkOutAt: attendanceSessions.checkOutAt,
    workedMinutes: attendanceSessions.workedMinutes,
    overtimeMinutes: attendanceSessions.overtimeMinutes,
    shortageMinutes: attendanceSessions.shortageMinutes,
    automaticTimeoutAt: attendanceSessions.automaticTimeoutAt,
    flagged: attendanceSessions.flagged,
    employeeDeletedAt: employees.deletedAt,
  }).from(attendanceSessions)
    .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
    .innerJoin(branches, eq(branches.id, sessionBranchId)).where(sessionWhere)
    .orderBy(asc(attendanceSessions.attendanceDate), asc(employees.employeeCode));
  const dailyQuery = executor.select({
    id: attendanceDailyRecords.id,
    employeeId: employees.id,
    employeeCode: employees.employeeCode,
    employeeName: employees.fullName,
    branchId: dailyBranchId,
    branchName: branches.name,
    attendanceDate: attendanceDailyRecords.attendanceDate,
    status: attendanceDailyRecords.status,
    requiredMinutes: attendanceDailyRecords.absenceRequiredMinutes,
    withoutPermissionAt: attendanceDailyRecords.withoutPermissionAt,
    employeeDeletedAt: employees.deletedAt,
  }).from(attendanceDailyRecords)
    .innerJoin(employees, eq(employees.id, attendanceDailyRecords.employeeId))
    .innerJoin(branches, eq(branches.id, dailyBranchId)).where(dailyWhere)
    .orderBy(asc(attendanceDailyRecords.attendanceDate), asc(employees.employeeCode));
  const [sessionAggregate, dailyAggregate] = await Promise.all([
    executor.select({
      value: count(),
      workedMinutes: sum(attendanceSessions.workedMinutes),
      overtimeMinutes: sum(attendanceSessions.overtimeMinutes),
      shortageMinutes: sum(attendanceSessions.shortageMinutes),
    }).from(attendanceSessions)
      .innerJoin(employees, eq(employees.id, attendanceSessions.employeeId))
      .where(sessionWhere),
    executor.select({
      value: count(),
      absenceRecords: sql<number>`sum(case when ${attendanceDailyRecords.status} = 'absence' then 1 else 0 end)`,
      weeklyDayOffRecords: sql<number>`sum(case when ${attendanceDailyRecords.status} = 'weekly_day_off' then 1 else 0 end)`,
      shortageMinutes: sql<number>`sum(case when ${attendanceDailyRecords.status} = 'absence' then ${attendanceDailyRecords.absenceRequiredMinutes} * (case when ${attendanceDailyRecords.withoutPermissionAt} is null then 1 else 2 end) else 0 end)`,
    }).from(attendanceDailyRecords)
      .innerJoin(employees, eq(employees.id, attendanceDailyRecords.employeeId))
      .where(dailyWhere),
  ]);
  const attendanceRecords = sessionAggregate[0]?.value ?? 0;
  const dailyRecords = dailyAggregate[0]?.value ?? 0;
  const offset = pagination ? (pagination.page - 1) * pagination.pageSize : 0;
  const pageSize = pagination?.pageSize ?? Number.POSITIVE_INFINITY;
  const sessionLimit = Math.max(0, Math.min(pageSize, attendanceRecords - offset));
  const sessionRows = pagination
    ? sessionLimit > 0 ? await sessionQuery.limit(sessionLimit).offset(offset) : []
    : await sessionQuery;
  const dailyLimit = pageSize - sessionRows.length;
  const dailyOffset = Math.max(0, offset - attendanceRecords);
  const dailyRows = pagination
    ? dailyLimit > 0 ? await dailyQuery.limit(dailyLimit).offset(dailyOffset) : []
    : await dailyQuery;
  const rows: Row[] = [
    ...sessionRows.map((row) => ({
      recordType: 'attendance', id: row.id, employeeId: row.employeeId,
      employeeCode: row.employeeCode, employeeName: row.employeeName,
      branchId: row.branchId, branchName: row.branchName,
      attendanceDate: row.attendanceDate, status: 'attendance', requiredMinutes: row.requiredMinutes,
      checkInAt: dateTime(row.checkInAt), checkOutAt: dateTime(row.checkOutAt),
      workedMinutes: row.workedMinutes, overtimeMinutes: row.overtimeMinutes,
      shortageMinutes: row.shortageMinutes, withoutPermission: false,
      automaticTimeoutAt: dateTime(row.automaticTimeoutAt),
      flagged: row.flagged, isEmployeeDeleted: Boolean(row.employeeDeletedAt),
    })),
    ...dailyRows.map((row) => ({
      recordType: 'daily_record', id: row.id, employeeId: row.employeeId,
      employeeCode: row.employeeCode, employeeName: row.employeeName,
      branchId: row.branchId, branchName: row.branchName,
      attendanceDate: row.attendanceDate, status: row.status, requiredMinutes: row.requiredMinutes,
      checkInAt: null, checkOutAt: null, workedMinutes: null, overtimeMinutes: 0,
      shortageMinutes: row.status === 'absence'
        ? row.requiredMinutes * (row.withoutPermissionAt === null ? 1 : 2)
        : 0,
      withoutPermission: row.withoutPermissionAt !== null,
      automaticTimeoutAt: null, flagged: false, isEmployeeDeleted: Boolean(row.employeeDeletedAt),
    })),
  ];
  const total = attendanceRecords + dailyRecords;
  const absenceRecords = Number(dailyAggregate[0]?.absenceRecords ?? 0);
  const weeklyDayOffRecords = Number(dailyAggregate[0]?.weeklyDayOffRecords ?? 0);
  return { kind: 'success', total, snapshot: snapshot(reportType, columns(
    ['recordType', 'نوع السجل'], ['id', 'الرقم'], ['employeeId', 'رقم الموظف'],
    ['employeeCode', 'كود الموظف'], ['employeeName', 'اسم الموظف'], ['branchId', 'رقم الفرع'],
    ['branchName', 'اسم الفرع'], ['attendanceDate', 'تاريخ الحضور'], ['status', 'الحالة'],
    ['requiredMinutes', 'الدقائق المطلوبة'], ['checkInAt', 'وقت الحضور'], ['checkOutAt', 'وقت الانصراف'],
    ['workedMinutes', 'دقائق العمل'], ['overtimeMinutes', 'دقائق إضافية'],
    ['shortageMinutes', 'دقائق النقص'], ['withoutPermission', 'غياب بدون إذن'],
    ['automaticTimeoutAt', 'وقت الانصراف التلقائي'],
    ['flagged', 'معلّم للمراجعة'], ['isEmployeeDeleted', 'موظف محذوف'],
  ), rows, {
    totalRecords: total, attendanceRecords, absenceRecords, weeklyDayOffRecords,
    totalWorkedMinutes: Number(sessionAggregate[0]?.workedMinutes ?? 0),
    totalOvertimeMinutes: Number(sessionAggregate[0]?.overtimeMinutes ?? 0),
    totalShortageMinutes: Number(sessionAggregate[0]?.shortageMinutes ?? 0)
      + Number(dailyAggregate[0]?.shortageMinutes ?? 0),
  }, generatedAt) };
};
