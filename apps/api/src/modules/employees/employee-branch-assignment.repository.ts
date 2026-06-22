import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { attendanceSessions, employeeBranchAssignments, employees } from "../../db";

type DatabaseSchema = typeof import("../../db/schema");
type Db = MySql2Database<DatabaseSchema>;

export type EmployeeBranchAssignmentRecord = {
  id: number;
  employeeId: number;
  branchId: number;
  effectiveFrom: string;
  effectiveTo: null | string;
  assignedByAdminId: number;
};

function mapEmployeeBranchAssignmentRecord(
  row: typeof employeeBranchAssignments.$inferSelect
): EmployeeBranchAssignmentRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    branchId: row.branchId,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
    assignedByAdminId: row.assignedByAdminId
  };
}

export async function listEmployeeBranchAssignments(db: Db, employeeId: number) {
  const rows = await db
    .select()
    .from(employeeBranchAssignments)
    .where(eq(employeeBranchAssignments.employeeId, employeeId))
    .orderBy(asc(employeeBranchAssignments.effectiveFrom));

  return rows.map(mapEmployeeBranchAssignmentRecord);
}

export async function findOpenAttendanceSession(db: Db, employeeId: number) {
  const rows = await db
    .select({ id: attendanceSessions.id })
    .from(attendanceSessions)
    .where(and(
      eq(attendanceSessions.employeeId, employeeId),
      eq(attendanceSessions.status, "open")
    ))
    .limit(1);

  return rows[0] ?? null;
}

export async function createBranchAssignment(db: Db, input: {
  employeeId: number;
  branchId: number;
  effectiveFrom: Date;
  assignedByAdminId: number;
  applyImmediately: boolean;
}) {
  if (input.applyImmediately) {
    await db.update(employeeBranchAssignments).set({
      effectiveTo: input.effectiveFrom
    }).where(and(
      eq(employeeBranchAssignments.employeeId, input.employeeId),
      isNull(employeeBranchAssignments.effectiveTo)
    ));

    await db.update(employees).set({
      branchId: input.branchId
    }).where(eq(employees.id, input.employeeId));
  }

  const result = await db.insert(employeeBranchAssignments).values({
    employeeId: input.employeeId,
    branchId: input.branchId,
    effectiveFrom: input.effectiveFrom,
    assignedByAdminId: input.assignedByAdminId
  });

  const rows = await db
    .select()
    .from(employeeBranchAssignments)
    .where(eq(employeeBranchAssignments.id, Number(result[0].insertId)))
    .limit(1);

  if (!rows[0]) {
    throw new Error("Failed to load branch assignment after create");
  }

  return mapEmployeeBranchAssignmentRecord(rows[0]);
}

export async function applyPendingBranchAssignment(db: Db, employeeId: number, occurredAtUtc: Date) {
  const rows = await db
    .select()
    .from(employeeBranchAssignments)
    .where(and(
      eq(employeeBranchAssignments.employeeId, employeeId),
      isNull(employeeBranchAssignments.effectiveTo),
      lte(employeeBranchAssignments.effectiveFrom, occurredAtUtc)
    ))
    .orderBy(desc(employeeBranchAssignments.effectiveFrom))
    .limit(1);

  const dueAssignment = rows[0];

  if (!dueAssignment) {
    return false;
  }

  await db.update(employees).set({
    branchId: dueAssignment.branchId
  }).where(eq(employees.id, employeeId));

  return true;
}
