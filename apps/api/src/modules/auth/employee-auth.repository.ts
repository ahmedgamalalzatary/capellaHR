import { eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { employees } from "../../db";

type DatabaseSchema = typeof import("../../db/schema");
type Db = MySql2Database<DatabaseSchema>;

export type EmployeeRecord = {
  id: number;
  fullName: string;
  primaryPhone: string;
  passwordHash: string;
  softDeletedAt: Date | null;
};

export async function findEmployeeByPhone(db: Db, phone: string): Promise<EmployeeRecord | null> {
  const rows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      primaryPhone: employees.primaryPhone,
      passwordHash: employees.passwordHash,
      softDeletedAt: employees.softDeletedAt
    })
    .from(employees)
    .where(eq(employees.primaryPhone, phone))
    .limit(1);

  return rows[0] ?? null;
}

export async function findEmployeeById(db: Db, id: number): Promise<EmployeeRecord | null> {
  const rows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      primaryPhone: employees.primaryPhone,
      passwordHash: employees.passwordHash,
      softDeletedAt: employees.softDeletedAt
    })
    .from(employees)
    .where(eq(employees.id, id))
    .limit(1);

  return rows[0] ?? null;
}
