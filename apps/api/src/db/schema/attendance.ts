import {
  date,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar
} from "drizzle-orm/mysql-core";
import { admins } from "./auth";
import { branches } from "./branches";
import { employees } from "./employees";
import { timestampColumns } from "./columns";

export const attendanceSessions = mysqlTable("attendance_sessions", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull().references(() => employees.id),
  branchId: int("branch_id").notNull().references(() => branches.id),
  status: mysqlEnum("status", ["open", "completed"]).notNull().default("open"),
  checkInAtUtc: datetime("check_in_at_utc").notNull(),
  checkOutAtUtc: datetime("check_out_at_utc"),
  checkInLatitude: decimal("check_in_latitude", { precision: 10, scale: 7 }).notNull(),
  checkInLongitude: decimal("check_in_longitude", { precision: 10, scale: 7 }).notNull(),
  checkInIpAddress: varchar("check_in_ip_address", { length: 64 }).notNull(),
  deviceId: varchar("device_id", { length: 255 }).notNull(),
  branchPolicySnapshot: json("branch_policy_snapshot").notNull(),
  adminReason: text("admin_reason"),
  createdByAdminId: int("created_by_admin_id").references(() => admins.id),
  updatedByAdminId: int("updated_by_admin_id").references(() => admins.id),
  ...timestampColumns
}, (table) => [
  index("attendance_sessions_employee_id_idx").on(table.employeeId),
  index("attendance_sessions_branch_id_idx").on(table.branchId),
  index("attendance_sessions_check_in_at_utc_idx").on(table.checkInAtUtc)
]);

export const attendanceBlockedAttempts = mysqlTable("attendance_blocked_attempts", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull().references(() => employees.id),
  branchId: int("branch_id").references(() => branches.id),
  attemptedAction: mysqlEnum("attempted_action", ["check_in", "check_out"]).notNull(),
  failureReasons: json("failure_reasons").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  ipAddress: varchar("ip_address", { length: 64 }),
  deviceId: varchar("device_id", { length: 255 }),
  branchPolicySnapshot: json("branch_policy_snapshot").notNull(),
  occurredAtUtc: datetime("occurred_at_utc").notNull(),
  ...timestampColumns
}, (table) => [
  index("attendance_blocked_attempts_employee_id_idx").on(table.employeeId),
  index("attendance_blocked_attempts_occurred_at_utc_idx").on(table.occurredAtUtc)
]);

export const weeklyDayOffAssignments = mysqlTable("weekly_day_off_assignments", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull().references(() => employees.id),
  weekStartDate: date("week_start_date").notNull(),
  dayOffDate: date("day_off_date").notNull(),
  overrideReason: text("override_reason"),
  assignedByAdminId: int("assigned_by_admin_id").notNull().references(() => admins.id),
  ...timestampColumns
}, (table) => [
  index("weekly_day_off_assignments_employee_id_idx").on(table.employeeId),
  index("weekly_day_off_assignments_week_start_date_idx").on(table.weekStartDate),
  uniqueIndex("weekly_day_off_assignments_employee_week_uq").on(table.employeeId, table.weekStartDate)
]);

export const permissionAbsences = mysqlTable("permission_absences", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull().references(() => employees.id),
  absenceDate: date("absence_date").notNull(),
  permissionType: varchar("permission_type", { length: 50 }).notNull().default("generic"),
  reason: text("reason"),
  createdByAdminId: int("created_by_admin_id").notNull().references(() => admins.id),
  updatedByAdminId: int("updated_by_admin_id").references(() => admins.id),
  ...timestampColumns
}, (table) => [
  index("permission_absences_employee_id_idx").on(table.employeeId),
  uniqueIndex("permission_absences_employee_date_uq").on(table.employeeId, table.absenceDate)
]);

export const monthLocks = mysqlTable("month_locks", {
  id: int("id").autoincrement().primaryKey(),
  monthKey: varchar("month_key", { length: 7 }).notNull(),
  lockedAt: datetime("locked_at").notNull(),
  lockedByAdminId: int("locked_by_admin_id").notNull().references(() => admins.id),
  notes: text("notes"),
  ...timestampColumns
}, (table) => [
  uniqueIndex("month_locks_month_key_uq").on(table.monthKey)
]);
