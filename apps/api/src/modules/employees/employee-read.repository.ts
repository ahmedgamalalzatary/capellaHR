import { and, asc, count, eq, isNotNull, isNull, like, type SQL } from "drizzle-orm";
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

  if (typeof filters.employeeId === "number") {
    conditions.push(eq(employees.id, filters.employeeId));
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

  const where = conditions.length === 0 ? undefined : and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;
  const rows = await db
    .select()
    .from(employees)
    .where(where)
    .orderBy(asc(employees.fullName))
    .limit(filters.pageSize)
    .offset(offset);
  const totalRows = await db
    .select({ value: count() })
    .from(employees)
    .where(where);
  const total = Number(totalRows[0]?.value ?? 0);

  return {
    items: rows.map(mapEmployeeRecord),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize))
    }
  };
}

export async function findEmployeeById(db: Db, employeeId: number) {
  const rows = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  return rows[0] ? mapEmployeeRecord(rows[0]) : null;
}
