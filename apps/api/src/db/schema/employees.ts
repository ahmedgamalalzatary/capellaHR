import {
  datetime,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar
} from "drizzle-orm/mysql-core";
import { admins } from "./auth";
import { branches } from "./branches";
import { timestampColumns } from "./columns";

export const employees = mysqlTable("employees", {
  id: int("id").autoincrement().primaryKey(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  primaryPhone: varchar("primary_phone", { length: 20 }).notNull(),
  whatsappPhone: varchar("whatsapp_phone", { length: 20 }).notNull(),
  email: varchar("email", { length: 255 }),
  branchId: int("branch_id").references(() => branches.id),
  age: int("age").notNull(),
  address: text("address").notNull(),
  currentMonthlySalary: decimal("current_monthly_salary", { precision: 12, scale: 2 }).notNull(),
  softDeletedAt: datetime("soft_deleted_at"),
  ...timestampColumns
}, (table) => [
  uniqueIndex("employees_primary_phone_uq").on(table.primaryPhone),
  uniqueIndex("employees_whatsapp_phone_uq").on(table.whatsappPhone),
  uniqueIndex("employees_email_uq").on(table.email),
  index("employees_full_name_idx").on(table.fullName),
  index("employees_branch_id_idx").on(table.branchId)
]);

export const employeeFiles = mysqlTable("employee_files", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull().references(() => employees.id),
  fileType: mysqlEnum("file_type", ["personal_photo", "id_front", "id_back"]).notNull(),
  storagePath: varchar("storage_path", { length: 512 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  fileSizeBytes: int("file_size_bytes").notNull(),
  replacedAt: datetime("replaced_at"),
  ...timestampColumns
}, (table) => [
  index("employee_files_employee_id_idx").on(table.employeeId)
]);

export const salaryHistory = mysqlTable("salary_history", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull().references(() => employees.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  effectiveAt: datetime("effective_at").notNull(),
  changedByAdminId: int("changed_by_admin_id").notNull().references(() => admins.id),
  ...timestampColumns
}, (table) => [
  index("salary_history_employee_id_idx").on(table.employeeId)
]);

export const employeeBranchAssignments = mysqlTable("employee_branch_assignments", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull().references(() => employees.id),
  branchId: int("branch_id").notNull().references(() => branches.id),
  effectiveFrom: datetime("effective_from").notNull(),
  effectiveTo: datetime("effective_to"),
  assignedByAdminId: int("assigned_by_admin_id").notNull().references(() => admins.id),
  ...timestampColumns
}, (table) => [
  index("employee_branch_assignments_employee_id_idx").on(table.employeeId),
  index("employee_branch_assignments_branch_id_idx").on(table.branchId)
]);

export const employeeDeviceRegistrations = mysqlTable("employee_device_registrations", {
  id: int("id").autoincrement().primaryKey(),
  employeeId: int("employee_id").notNull().references(() => employees.id),
  deviceToken: varchar("device_token", { length: 255 }).notNull(),
  deviceLabel: varchar("device_label", { length: 255 }),
  browserFingerprint: varchar("browser_fingerprint", { length: 255 }),
  status: mysqlEnum("status", ["pending", "active", "revoked", "replaced"]).notNull().default("pending"),
  registeredAt: datetime("registered_at"),
  revokedAt: datetime("revoked_at"),
  expiresAt: datetime("expires_at"),
  ...timestampColumns
}, (table) => [
  uniqueIndex("employee_device_registrations_device_token_uq").on(table.deviceToken),
  index("employee_device_registrations_employee_id_idx").on(table.employeeId)
]);
