import {
  datetime,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar
} from "drizzle-orm/mysql-core";
import { employees } from "./employees";
import { timestampColumns } from "./columns";

export const admins = mysqlTable("admins", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  lastLoginAt: datetime("last_login_at"),
  ...timestampColumns
}, (table) => [
  uniqueIndex("admins_email_uq").on(table.email)
]);

export const adminSessions = mysqlTable("admin_sessions", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("admin_id").notNull().references(() => admins.id),
  tokenHash: varchar("token_hash", { length: 255 }).notNull(),
  expiresAt: datetime("expires_at").notNull(),
  revokedAt: datetime("revoked_at"),
  ...timestampColumns
}, (table) => [
  uniqueIndex("admin_sessions_token_hash_uq").on(table.tokenHash),
  index("admin_sessions_admin_id_idx").on(table.adminId),
  index("admin_sessions_expires_at_idx").on(table.expiresAt)
]);

export const employeeSessions = mysqlTable("employee_sessions", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull().references(() => employees.id),
  tokenHash: varchar("token_hash", { length: 255 }).notNull(),
  expiresAt: datetime("expires_at").notNull(),
  revokedAt: datetime("revoked_at"),
  ...timestampColumns
}, (table) => [
  uniqueIndex("employee_sessions_token_hash_uq").on(table.tokenHash),
  index("employee_sessions_employee_id_idx").on(table.employeeId),
  index("employee_sessions_expires_at_idx").on(table.expiresAt)
]);
