import type { MySql2Database } from "drizzle-orm/mysql2";

type DatabaseSchema = typeof import("../db/schema");

const tableNames = [
  "attendance_blocked_attempts",
  "attendance_sessions",
  "weekly_day_off_assignments",
  "permission_absences",
  "employee_device_registrations",
  "employee_branch_assignments",
  "employee_files",
  "employee_sessions",
  "salary_history",
  "employees",
  "branch_device_registrations",
  "branch_setup_links",
  "branches",
  "admin_sessions",
  "audit_logs",
  "month_locks",
  "admins"
] as const;

export async function resetTestDatabase(db: MySql2Database<DatabaseSchema>) {
  await db.execute("SET FOREIGN_KEY_CHECKS = 0");

  try {
    for (const tableName of tableNames) {
      await db.execute(`TRUNCATE TABLE \`${tableName}\``);
    }
  } finally {
    await db.execute("SET FOREIGN_KEY_CHECKS = 1");
  }
}
