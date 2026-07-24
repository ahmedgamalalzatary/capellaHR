import { type createDatabase } from '@capella/database';
import { attendanceDailyRecords, branches, employeeBranchAssignments, employees } from '@capella/database/schema';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import { branchIdAt } from '../../shared/database/branch-id-at.js';
import type {
  WeeklyDayOffFinancialLockCheck,
  WeeklyDayOffRepository,
  WeeklyDayRecord,
} from './weekly-day-off-service.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

const historicalAssignment = branchIdAt(
  employeeBranchAssignments, attendanceDailyRecords.employeeId, attendanceDailyRecords.createdAt,
);
const historicalBranchId = sql<number>`coalesce(${attendanceDailyRecords.branchId}, ${historicalAssignment.branchId})`;
const assignmentAtCreation = historicalAssignment.assignment;
const recordFields = {
  id: attendanceDailyRecords.id,
  employeeId: employees.id,
  employeeCode: employees.employeeCode,
  employeeName: employees.fullName,
  branchId: historicalBranchId,
  branchName: branches.name,
  attendanceDate: attendanceDailyRecords.attendanceDate,
  status: sql<WeeklyDayRecord['status']>`${attendanceDailyRecords.status}`,
  absenceRequiredMinutes: attendanceDailyRecords.absenceRequiredMinutes,
  requiredMinutes: sql<number>`case when ${attendanceDailyRecords.status} = 'weekly_day_off' then 0 else ${attendanceDailyRecords.absenceRequiredMinutes} end`.mapWith(Number),
  dayOffConvertedAt: attendanceDailyRecords.dayOffConvertedAt,
  createdAt: attendanceDailyRecords.createdAt,
  updatedAt: attendanceDailyRecords.updatedAt,
};

const findActiveRecord = async (
  executor: Executor,
  id: number,
): Promise<WeeklyDayRecord | null> => (
  await executor.select(recordFields)
    .from(attendanceDailyRecords)
    .innerJoin(employees, eq(employees.id, attendanceDailyRecords.employeeId))
    .leftJoin(employeeBranchAssignments, assignmentAtCreation)
    .innerJoin(branches, eq(branches.id, historicalBranchId))
    .where(and(
      eq(attendanceDailyRecords.id, id),
      isNull(employees.deletedAt),
      ne(attendanceDailyRecords.status, 'attendance_replaced'),
    ))
    .limit(1)
)[0] ?? null;

const findRecordEmployeeId = async (transaction: Transaction, id: number) => (
  await transaction.select({ employeeId: attendanceDailyRecords.employeeId })
    .from(attendanceDailyRecords)
    .where(eq(attendanceDailyRecords.id, id))
    .limit(1)
)[0]?.employeeId;

const lockActiveEmployee = async (transaction: Transaction, employeeId: number) => (
  await transaction.select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .for('update')
    .limit(1)
)[0] !== undefined;

const lockRecord = async (transaction: Transaction, id: number, employeeId: number) => (
  await transaction.select({
    id: attendanceDailyRecords.id,
    employeeId: attendanceDailyRecords.employeeId,
    attendanceDate: attendanceDailyRecords.attendanceDate,
    status: attendanceDailyRecords.status,
  })
    .from(attendanceDailyRecords)
    .where(and(
      eq(attendanceDailyRecords.id, id),
      eq(attendanceDailyRecords.employeeId, employeeId),
    ))
    .for('update')
    .limit(1)
)[0];

const financiallyLocked = (
  check: WeeklyDayOffFinancialLockCheck,
  employeeId: number,
  attendanceDate: string,
  transaction: Transaction,
) => check(employeeId, attendanceDate, transaction);

export const createDrizzleWeeklyDayOffRepository = (
  database: Database,
  now: () => Date = () => new Date(),
): WeeklyDayOffRepository => ({
  findById(id) {
    return findActiveRecord(database, id);
  },

  async list(query) {
    const filters = [
      isNull(employees.deletedAt),
      ne(attendanceDailyRecords.status, 'attendance_replaced'),
    ];
    if (query.employeeId !== undefined) filters.push(eq(employees.id, query.employeeId));
    if (query.branchId !== undefined) filters.push(eq(historicalBranchId, query.branchId));
    if (query.status !== undefined) filters.push(eq(attendanceDailyRecords.status, query.status));
    if (query.dateFrom !== undefined) filters.push(gte(attendanceDailyRecords.attendanceDate, query.dateFrom));
    if (query.dateTo !== undefined) filters.push(lte(attendanceDailyRecords.attendanceDate, query.dateTo));
    if (query.search !== undefined) {
      filters.push(or(
        sql`locate(${query.search}, ${employees.fullName}) > 0`,
        sql`locate(${query.search}, cast(${employees.employeeCode} as char)) > 0`,
        sql`locate(${query.search}, ${branches.name}) > 0`,
      )!);
    }
    const where = and(...filters);
    const join = (executor: Executor) => executor.select(recordFields)
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(employees.id, attendanceDailyRecords.employeeId))
      .leftJoin(employeeBranchAssignments, assignmentAtCreation)
      .innerJoin(branches, eq(branches.id, historicalBranchId));
    const items = await join(database)
      .where(where)
      .orderBy(desc(attendanceDailyRecords.attendanceDate), asc(employees.employeeCode))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() })
      .from(attendanceDailyRecords)
      .innerJoin(employees, eq(employees.id, attendanceDailyRecords.employeeId))
      .leftJoin(employeeBranchAssignments, assignmentAtCreation)
      .innerJoin(branches, eq(branches.id, historicalBranchId))
      .where(where);
    return { items, total: totals[0]?.value ?? 0 };
  },

  convertToDayOff(id, today, isFinanciallyLocked) {
    return database.transaction(async (transaction) => {
      const employeeId = await findRecordEmployeeId(transaction, id);
      if (employeeId === undefined || !await lockActiveEmployee(transaction, employeeId)) {
        return { kind: 'not_found' as const };
      }
      const record = await lockRecord(transaction, id, employeeId);
      if (!record) return { kind: 'not_found' as const };
      if (record.attendanceDate >= today) return { kind: 'not_past' as const };
      if (record.status !== 'absence') return { kind: 'not_absence' as const };
      if (await financiallyLocked(
        isFinanciallyLocked,
        employeeId,
        record.attendanceDate,
        transaction,
      )) return { kind: 'financially_locked' as const };

      const conflicting = await transaction.select({ id: attendanceDailyRecords.id })
        .from(attendanceDailyRecords)
        .where(and(
          eq(attendanceDailyRecords.employeeId, employeeId),
          eq(attendanceDailyRecords.status, 'weekly_day_off'),
          ne(attendanceDailyRecords.id, id),
          sql`${attendanceDailyRecords.attendanceDate} between date_sub(${record.attendanceDate}, interval 6 day) and date_add(${record.attendanceDate}, interval 6 day)`,
        ))
        .for('update')
        .limit(1);
      if (conflicting[0]) return { kind: 'spacing_conflict' as const };

      const convertedAt = now();
      await transaction.update(attendanceDailyRecords).set({
        status: 'weekly_day_off',
        dayOffConvertedAt: convertedAt,
        updatedAt: convertedAt,
      }).where(and(
        eq(attendanceDailyRecords.id, id),
        eq(attendanceDailyRecords.status, 'absence'),
      ));
      const updated = await findActiveRecord(transaction, id);
      if (!updated) throw new Error('Weekly day-off record disappeared during conversion');
      await writeAudit(transaction, {
        module: 'weekly-day-off', action: 'convert',
        entityType: 'attendance_daily_record', entityId: id,
        beforeState: record, afterState: updated,
        relatedIds: { employeeId }, createdAt: convertedAt,
      });
      return { kind: 'success' as const, record: updated };
    });
  },

  revertToAbsence(id, isFinanciallyLocked) {
    return database.transaction(async (transaction) => {
      const employeeId = await findRecordEmployeeId(transaction, id);
      if (employeeId === undefined || !await lockActiveEmployee(transaction, employeeId)) {
        return { kind: 'not_found' as const };
      }
      const record = await lockRecord(transaction, id, employeeId);
      if (!record) return { kind: 'not_found' as const };
      if (record.status !== 'weekly_day_off') return { kind: 'not_day_off' as const };
      if (await financiallyLocked(
        isFinanciallyLocked,
        employeeId,
        record.attendanceDate,
        transaction,
      )) return { kind: 'financially_locked' as const };

      const revertedAt = now();
      await transaction.update(attendanceDailyRecords).set({
        status: 'absence',
        dayOffConvertedAt: null,
        updatedAt: revertedAt,
      }).where(and(
        eq(attendanceDailyRecords.id, id),
        eq(attendanceDailyRecords.status, 'weekly_day_off'),
      ));
      const updated = await findActiveRecord(transaction, id);
      if (!updated) throw new Error('Weekly day-off record disappeared during reversion');
      await writeAudit(transaction, {
        module: 'weekly-day-off', action: 'revert',
        entityType: 'attendance_daily_record', entityId: id,
        beforeState: record, afterState: updated,
        relatedIds: { employeeId }, createdAt: revertedAt,
      });
      return { kind: 'success' as const, record: updated };
    });
  },
});
