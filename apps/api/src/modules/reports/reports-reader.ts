import type {
  ReportCell,
  ReportColumn,
  ReportFilters,
  ReportSelection,
  ReportSnapshot,
  ReportType,
} from '@capella/contracts';
import {
  advanceInstallments,
  advances,
  attendanceDailyRecords,
  attendanceSessions,
  bonuses,
  branches,
  deductions,
  devices,
  employees,
} from '@capella/database/schema';
import {
  and,
  asc,
  count,
  eq,
  exists,
  gte,
  inArray,
  lte,
  ne,
  or,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm';

import type { Database } from '../payroll/financial-repository-helpers.js';
import { calendarMonthInTimeZone, type PayrollResult } from '../payroll/index.js';
import type { ReportReader } from './reports-service.js';

type Pagination = { page: number; pageSize: number; purpose?: 'screen' | 'availability' } | null;
type Row = Record<string, ReportCell>;
type Executor = Parameters<Parameters<Database['transaction']>[0]>[0];
const snapshotTransactionConfig = {
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

const columns = (...entries: Array<[string, string]>): ReportColumn[] => entries.map(([key, label]) => ({ key, label }));
const whereFrom = (filters: SQL[]) => filters.length ? and(...filters) : undefined;
const dateTime = (value: Date | null) => value?.toISOString() ?? null;
const monthStart = (value: string) => `${value}-01`;
const dateAt = (instant: Date, formatter: Intl.DateTimeFormat) => {
  const parts = Object.fromEntries(formatter
    .formatToParts(instant).filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const startOfDate = (value: string, timeZone: string) => {
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
const endOfDate = (value: string, timeZone: string) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return new Date(startOfDate(nextDate, timeZone).valueOf() - 1);
};
const selected = (selection: ReportSelection, column: Parameters<typeof inArray>[0]): SQL[] =>
  selection.mode === 'selected' ? [inArray(column, selection.ids)] : [];
const searchEmployee = (search: string) => or(
  sql`locate(${search}, ${employees.fullName}) > 0`,
  sql`locate(${search}, cast(${employees.employeeCode} as char)) > 0`,
  sql`locate(${search}, ${employees.personalPhone}) > 0`,
  sql`locate(${search}, ${employees.whatsappPhone}) > 0`,
)!;
const employeeFilters = (filters: ReportFilters, selection: ReportSelection): SQL[] => [
  ...(filters.branchId === undefined ? [] : [eq(employees.branchId, filters.branchId)]),
  ...(filters.search === undefined ? [] : [searchEmployee(filters.search)]),
  ...selected(selection, employees.id),
];
const paginate = <T>(query: { limit(value: number): { offset(value: number): Promise<T[]> } }, pagination: Pagination) =>
  pagination ? query.limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize) : query as unknown as Promise<T[]>;
const snapshot = (
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

const monthsBetween = (from: string, to: string) => {
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
const moneyCents = (value: string) => {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
};
const moneyFromCents = (value: bigint) => {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const formatted = `${unsigned / 100n}.${String(unsigned % 100n).padStart(2, '0')}`;
  return negative ? `-${formatted}` : formatted;
};
type SuccessfulPayroll = Extract<PayrollResult, { kind: 'success' }>['payroll'];
const payrollReportRow = (row: SuccessfulPayroll, isEmployeeDeleted: boolean): Row => ({
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
  attendanceDeductionAmount: row.attendanceDeductionAmount,
  manualDeductionAmount: row.manualDeductionAmount,
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

export const createDrizzleReportReader = (
  database: Database,
  options: {
    timeZone?: string;
    now?: () => Date;
    payroll?: ReportsPayrollGateway;
    maxInteractivePayrollCandidates?: number;
  } = {},
): ReportReader => {
  const timeZone = options.timeZone ?? 'Africa/Cairo';
  const now = options.now ?? (() => new Date());
  const maxInteractivePayrollCandidates = options.maxInteractivePayrollCandidates ?? 5_000;
  if (!Number.isSafeInteger(maxInteractivePayrollCandidates) || maxInteractivePayrollCandidates < 1) {
    throw new Error('maxInteractivePayrollCandidates must be a positive safe integer');
  }
  // Validate configuration at construction instead of failing during a request.
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(0));
  const readWith = async (
    executor: Executor,
    reportType: ReportType,
    filters: ReportFilters,
    selection: ReportSelection,
    pagination: Pagination,
    generatedAt: Date,
  ): ReturnType<ReportReader['read']> => {

    if (reportType === 'attendance') {
      const common = employeeFilters(filters, selection);
      const sessionWhere = whereFrom([
        ...common,
        ...(filters.dateFrom === undefined ? [] : [gte(attendanceSessions.attendanceDate, filters.dateFrom)]),
        ...(filters.dateTo === undefined ? [] : [lte(attendanceSessions.attendanceDate, filters.dateTo)]),
      ]);
      const dailyWhere = whereFrom([
        ...common,
        ne(attendanceDailyRecords.status, 'attendance_replaced'),
        ...(filters.dateFrom === undefined ? [] : [gte(attendanceDailyRecords.attendanceDate, filters.dateFrom)]),
        ...(filters.dateTo === undefined ? [] : [lte(attendanceDailyRecords.attendanceDate, filters.dateTo)]),
      ]);
      const sessionQuery = executor.select({
        id: attendanceSessions.id,
        employeeId: employees.id,
        employeeCode: employees.employeeCode,
        employeeName: employees.fullName,
        branchId: employees.branchId,
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
        .innerJoin(branches, eq(branches.id, employees.branchId)).where(sessionWhere)
        .orderBy(asc(attendanceSessions.attendanceDate), asc(employees.employeeCode));
      const dailyQuery = executor.select({
        id: attendanceDailyRecords.id,
        employeeId: employees.id,
        employeeCode: employees.employeeCode,
        employeeName: employees.fullName,
        branchId: employees.branchId,
        branchName: branches.name,
        attendanceDate: attendanceDailyRecords.attendanceDate,
        status: attendanceDailyRecords.status,
        requiredMinutes: attendanceDailyRecords.absenceRequiredMinutes,
        employeeDeletedAt: employees.deletedAt,
      }).from(attendanceDailyRecords)
        .innerJoin(employees, eq(employees.id, attendanceDailyRecords.employeeId))
        .innerJoin(branches, eq(branches.id, employees.branchId)).where(dailyWhere)
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
          shortageMinutes: sql<number>`sum(case when ${attendanceDailyRecords.status} = 'absence' then ${attendanceDailyRecords.absenceRequiredMinutes} else 0 end)`,
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
          shortageMinutes: row.shortageMinutes, automaticTimeoutAt: dateTime(row.automaticTimeoutAt),
          flagged: row.flagged, isEmployeeDeleted: Boolean(row.employeeDeletedAt),
        })),
        ...dailyRows.map((row) => ({
          recordType: 'daily_record', id: row.id, employeeId: row.employeeId,
          employeeCode: row.employeeCode, employeeName: row.employeeName,
          branchId: row.branchId, branchName: row.branchName,
          attendanceDate: row.attendanceDate, status: row.status, requiredMinutes: row.requiredMinutes,
          checkInAt: null, checkOutAt: null, workedMinutes: null, overtimeMinutes: 0,
          shortageMinutes: row.status === 'absence' ? row.requiredMinutes : 0,
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
        ['shortageMinutes', 'دقائق النقص'], ['automaticTimeoutAt', 'وقت الانصراف التلقائي'],
        ['flagged', 'معلّم للمراجعة'], ['isEmployeeDeleted', 'موظف محذوف'],
      ), rows, {
        totalRecords: total, attendanceRecords, absenceRecords, weeklyDayOffRecords,
        totalWorkedMinutes: Number(sessionAggregate[0]?.workedMinutes ?? 0),
        totalOvertimeMinutes: Number(sessionAggregate[0]?.overtimeMinutes ?? 0),
        totalShortageMinutes: Number(sessionAggregate[0]?.shortageMinutes ?? 0)
          + Number(dailyAggregate[0]?.shortageMinutes ?? 0),
      }, generatedAt) };
    }

    if (reportType === 'payroll') {
      if (!options.payroll) return { kind: 'unavailable' };
      const currentMonth = calendarMonthInTimeZone(now(), timeZone);
      const monthFrom = filters.monthFrom ?? currentMonth;
      const monthTo = filters.monthTo ?? currentMonth;
      if (monthTo > currentMonth) return { kind: 'unavailable' };
      const reportMonths = monthsBetween(monthFrom, monthTo);
      if (pagination?.purpose === 'availability') {
        return readWith(
          executor,
          reportType,
          filters,
          { mode: 'selected', ids: [0] },
          { page: 1, pageSize: 1 },
          generatedAt,
        );
      }
      const matchingEmployeeCount = (await executor.select({ value: count() })
        .from(employees).where(whereFrom(employeeFilters(filters, selection))))[0]?.value ?? 0;
      if (matchingEmployeeCount * reportMonths.length > maxInteractivePayrollCandidates) {
        return { kind: 'unavailable' };
      }
      const employeeRows = await executor.select({ id: employees.id, deletedAt: employees.deletedAt })
        .from(employees).where(whereFrom(employeeFilters(filters, selection)))
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
          const result = await options.payroll.preview(employee.id, month, executor);
          if (result.kind === 'blocked') return { kind: 'unavailable' };
          if (result.kind !== 'success') continue;
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
        ['attendanceDeductionAmount', 'خصم الحضور'], ['manualDeductionAmount', 'الخصومات اليدوية'],
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
    }

    if (reportType === 'branches') {
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
    }

    if (reportType === 'employees' || reportType === 'shifts') {
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
    }

    if (reportType === 'devices') {
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
    }

    if (reportType === 'weekly-day-off') {
      const conditions = [
        eq(attendanceDailyRecords.status, 'weekly_day_off'),
        ...employeeFilters(filters, selection),
        ...(filters.dateFrom === undefined ? [] : [gte(attendanceDailyRecords.attendanceDate, filters.dateFrom)]),
        ...(filters.dateTo === undefined ? [] : [lte(attendanceDailyRecords.attendanceDate, filters.dateTo)]),
      ];
      const where = whereFrom(conditions);
      const query = executor.select({
        id: attendanceDailyRecords.id,
        employeeId: employees.id,
        employeeCode: employees.employeeCode,
        employeeName: employees.fullName,
        branchId: employees.branchId,
        branchName: branches.name,
        attendanceDate: attendanceDailyRecords.attendanceDate,
        requiredMinutes: attendanceDailyRecords.absenceRequiredMinutes,
        convertedAt: attendanceDailyRecords.dayOffConvertedAt,
        employeeDeletedAt: employees.deletedAt,
      }).from(attendanceDailyRecords)
        .innerJoin(employees, eq(employees.id, attendanceDailyRecords.employeeId))
        .innerJoin(branches, eq(branches.id, employees.branchId))
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
    }

    if (reportType === 'bonuses' || reportType === 'deductions') {
      const table = reportType === 'bonuses' ? bonuses : deductions;
      const conditions = [
        ...employeeFilters(filters, selection),
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
        branchId: employees.branchId,
        branchName: branches.name,
        payrollMonth: table.payrollMonth,
        amount: table.amount,
        employeeDeletedAt: employees.deletedAt,
        createdAt: table.createdAt,
        updatedAt: table.updatedAt,
      }).from(table).innerJoin(employees, eq(employees.id, table.employeeId))
        .innerJoin(branches, eq(branches.id, employees.branchId))
        .where(where).orderBy(asc(table.payrollMonth), asc(table.id));
      const [records, aggregate] = await Promise.all([
        paginate(query, pagination),
        executor.select({ value: count(), amount: sum(table.amount) }).from(table)
          .innerJoin(employees, eq(employees.id, table.employeeId)).where(where),
      ]);
      const total = aggregate[0]?.value ?? 0;
      const rows = records.map((row) => ({
        ...row,
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
        ['payrollMonth', 'شهر الراتب'], ['amount', 'المبلغ'], ['isEmployeeDeleted', 'موظف محذوف'],
        ['createdAt', 'تاريخ الإنشاء'], ['updatedAt', 'آخر تحديث'],
      ), rows, { totalRecords: total, totalAmount: aggregate[0]?.amount ?? '0.00' }, generatedAt) };
    }

    const conditions = [
      ...employeeFilters(filters, selection),
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
      branchId: employees.branchId,
      branchName: branches.name,
      amount: advances.amount,
      installmentCount: advances.installmentCount,
      startMonth: advances.startMonth,
      employeeDeletedAt: employees.deletedAt,
      createdAt: advances.createdAt,
      updatedAt: advances.updatedAt,
    }).from(advances).innerJoin(employees, eq(employees.id, advances.employeeId))
      .innerJoin(branches, eq(branches.id, employees.branchId))
      .where(where).orderBy(asc(advances.startMonth), asc(advances.id));
    const [records, aggregate] = await Promise.all([
      paginate(query, pagination),
      executor.select({ value: count(), amount: sum(advances.amount) }).from(advances)
        .innerJoin(employees, eq(employees.id, advances.employeeId)).where(where),
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

  return {
    read(reportType, filters, selection, pagination, generatedAt) {
      if (reportType === 'payroll' && !options.payroll) {
        return Promise.resolve({ kind: 'unavailable' as const });
      }
      return database.transaction((transaction) => readWith(
        transaction,
        reportType,
        filters,
        selection,
        pagination,
        generatedAt,
      ), snapshotTransactionConfig);
    },

    readBatches(reportType, filters, selection, batchSize, generatedAt, onBatch) {
      if (reportType === 'payroll' && !options.payroll) {
        return Promise.resolve({ kind: 'unavailable' as const });
      }
      return database.transaction(async (transaction) => {
        if (reportType === 'payroll') {
          const currentMonth = calendarMonthInTimeZone(now(), timeZone);
          const monthFrom = filters.monthFrom ?? currentMonth;
          const monthTo = filters.monthTo ?? currentMonth;
          if (monthTo > currentMonth) return { kind: 'unavailable' as const };

          const metadata = await readWith(
            transaction,
            reportType,
            filters,
            { mode: 'selected', ids: [0] },
            { page: 1, pageSize: 1 },
            generatedAt,
          );
          if (metadata.kind === 'unavailable') return metadata;
          const header: Omit<ReportSnapshot, 'rows'> = {
            reportType: metadata.snapshot.reportType,
            title: metadata.snapshot.title,
            generatedAt: metadata.snapshot.generatedAt,
            columns: metadata.snapshot.columns,
            summary: metadata.snapshot.summary,
          };

          const employeePageSize = Math.max(1, Math.min(batchSize, 250));
          let batch: Row[] = [];
          let rowCount = 0;
          let openRecords = 0;
          let finalizedRecords = 0;
          let totalNetSalaryCents = 0n;
          for (const month of monthsBetween(monthFrom, monthTo)) {
            let employeeOffset = 0;
            while (true) {
              const employeeRows = await transaction.select({ id: employees.id, deletedAt: employees.deletedAt })
                .from(employees).where(whereFrom(employeeFilters(filters, selection)))
                .orderBy(asc(employees.employeeCode))
                .limit(employeePageSize).offset(employeeOffset);
              if (!employeeRows.length) break;
              employeeOffset += employeeRows.length;
              for (const employee of employeeRows) {
                const result = await options.payroll!.preview(employee.id, month, transaction);
                if (result.kind === 'blocked') return { kind: 'unavailable' as const };
                if (result.kind !== 'success') continue;
                batch.push(payrollReportRow(result.payroll, Boolean(employee.deletedAt)));
                rowCount += 1;
                if (result.payroll.status === 'open') openRecords += 1;
                else finalizedRecords += 1;
                totalNetSalaryCents += moneyCents(result.payroll.netSalary);
                if (batch.length === batchSize) {
                  await onBatch(batch);
                  batch = [];
                }
              }
              if (employeeRows.length < employeePageSize) break;
            }
          }
          if (batch.length) await onBatch(batch);
          return {
            kind: 'success' as const,
            snapshot: {
              ...header,
              summary: {
                totalRecords: rowCount,
                openRecords,
                finalizedRecords,
                totalNetSalary: moneyFromCents(totalNetSalaryCents),
              },
            },
            total: rowCount,
            rowCount,
          };
        }

        let page = 1;
        let rowCount = 0;
        let total = 0;
        let header: Omit<ReportSnapshot, 'rows'> | undefined;
        do {
          const result = await readWith(
            transaction,
            reportType,
            filters,
            selection,
            { page, pageSize: batchSize },
            generatedAt,
          );
          if (result.kind === 'unavailable') return result;
          const { rows, ...currentHeader } = result.snapshot;
          header ??= currentHeader;
          total = result.total;
          if (!rows.length) break;
          await onBatch(rows);
          rowCount += rows.length;
          page += 1;
        } while (rowCount < total);

        if (!header) throw new Error(`Report ${reportType} did not provide snapshot metadata`);
        return { kind: 'success' as const, snapshot: header, total, rowCount };
      }, snapshotTransactionConfig);
    },
  };
};
