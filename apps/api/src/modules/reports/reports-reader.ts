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
  or,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm';

import type { Database } from '../payroll/financial-repository-helpers.js';
import type { ReportReader } from './reports-service.js';

type Pagination = { page: number; pageSize: number } | null;
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

export const createDrizzleReportReader = (
  database: Database,
  options: { timeZone?: string } = {},
): ReportReader => {
  const timeZone = options.timeZone ?? 'Africa/Cairo';
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
        monthlyBaseSalary: Number(row.monthlyBaseSalary),
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
        credentialDeviceType: devices.credentialDeviceType,
        credentialBackedUp: devices.credentialBackedUp,
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
        ['branchName', 'اسم الفرع'], ['credentialDeviceType', 'نوع الجهاز'],
        ['credentialBackedUp', 'بيانات الاعتماد منسوخة'], ['browser', 'المتصفح'], ['platform', 'النظام'],
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
        amount: Number(row.amount),
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
      ), rows, { totalRecords: total, totalAmount: Number(aggregate[0]?.amount ?? 0) }, generatedAt) };
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
      amount: Number(row.amount),
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
    ), rows, { totalRecords: total, totalAmount: Number(aggregate[0]?.amount ?? 0) }, generatedAt) };
  };

  return {
    read(reportType, filters, selection, pagination, generatedAt) {
      if (reportType === 'attendance' || reportType === 'payroll') {
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
      if (reportType === 'attendance' || reportType === 'payroll') {
        return Promise.resolve({ kind: 'unavailable' as const });
      }
      return database.transaction(async (transaction) => {
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
