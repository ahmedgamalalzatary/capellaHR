import { type createDatabase } from '@capella/database';
import { branches, employees } from '@capella/database/schema';
import { and, asc, count, eq, isNull, or, sql } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import type {
  ShiftAssignmentRecord,
  ShiftRepository,
  ShiftTransactionContext,
} from './shifts-service.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

const assignmentFields = {
  employeeId: employees.id,
  employeeCode: employees.employeeCode,
  employeeName: employees.fullName,
  branchId: employees.branchId,
  branchName: branches.name,
  durationMinutes: employees.shiftDurationMinutes,
};

const findActiveAssignment = async (
  executor: Executor,
  employeeId: number,
): Promise<ShiftAssignmentRecord | null> => (
  await executor.select(assignmentFields)
    .from(employees)
    .innerJoin(branches, eq(branches.id, employees.branchId))
    .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .limit(1)
)[0] ?? null;

export const createDrizzleShiftRepository = (
  database: Database,
  now: () => Date = () => new Date(),
): ShiftRepository => ({
  findByEmployeeId(employeeId) {
    return findActiveAssignment(database, employeeId);
  },

  async list(query) {
    const filters = [isNull(employees.deletedAt)];
    if (query.branchId !== undefined) filters.push(eq(employees.branchId, query.branchId));
    if (query.search !== undefined) {
      filters.push(or(
        sql`locate(${query.search}, ${employees.fullName}) > 0`,
        sql`locate(${query.search}, cast(${employees.employeeCode} as char)) > 0`,
      )!);
    }

    const where = and(...filters);
    const items = await database.select(assignmentFields)
      .from(employees)
      .innerJoin(branches, eq(branches.id, employees.branchId))
      .where(where)
      .orderBy(asc(employees.employeeCode))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() }).from(employees).where(where);

    return { items, total: totals[0]?.value ?? 0 };
  },

  updateDuration(employeeId, durationMinutes) {
    return database.transaction(async (transaction) => {
      const current = await transaction.select({
        id: employees.id,
        durationMinutes: employees.shiftDurationMinutes,
      })
        .from(employees)
        .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
        .for('update')
        .limit(1);
      if (!current[0]) return null;

      const updatedAt = now();
      await transaction.update(employees)
        .set({ shiftDurationMinutes: durationMinutes, updatedAt })
        .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)));

      const after = await findActiveAssignment(transaction, employeeId);
      await writeAudit(transaction, {
        module: 'shifts', action: 'update', entityType: 'shift_assignment', entityId: employeeId,
        beforeState: current[0], afterState: after,
        relatedIds: { employeeId }, createdAt: updatedAt,
      });
      return after;
    });
  },

  async lockDurationForCheckIn(employeeId, context: ShiftTransactionContext) {
    const transaction = context as Transaction;
    const row = await transaction.select({ durationMinutes: employees.shiftDurationMinutes })
      .from(employees)
      .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
      .for('update')
      .limit(1);
    return row[0]?.durationMinutes ?? null;
  },
});
