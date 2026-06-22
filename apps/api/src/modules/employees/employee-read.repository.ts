import { and, asc, eq, isNotNull, isNull, like, type SQL } from "drizzle-orm";
import type { EmployeeListFilterInput } from "@capella/shared";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { branches, employees } from "../../db";
import { mapEmployeeRecord } from "./employee-mappers";

type DatabaseSchema = typeof import("../../db/schema");
type Db = MySql2Database<DatabaseSchema>;

export async function findBranchSetupStatus(db: Db, branchId: number) {
  const rows = await db
    .select({
      setupStatus: branches.setupStatus
    })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);

  return rows[0]?.setupStatus ?? null;
}

export async function listEmployees(db: Db, filters: EmployeeListFilterInput) {
  const conditions: SQL[] = [];

  if (filters.search) {
    conditions.push(like(employees.fullName, `%${filters.search}%`));
  }

  if (typeof filters.branchId === "number") {
    conditions.push(eq(employees.branchId, filters.branchId));
  }

  if (filters.status === "active") {
    conditions.push(isNull(employees.softDeletedAt));
  }

  if (filters.status === "soft_deleted") {
    conditions.push(isNotNull(employees.softDeletedAt));
  }

  const query = db.select().from(employees).orderBy(asc(employees.fullName));
  const rows = conditions.length === 0
    ? await query
    : await query.where(and(...conditions));

  return rows.map(mapEmployeeRecord);
}

export async function findEmployeeById(db: Db, employeeId: number) {
  const rows = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  return rows[0] ? mapEmployeeRecord(rows[0]) : null;
}
