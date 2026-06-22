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
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/mysql-core";

const timestampColumns = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull()
};

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

export const branches = mysqlTable("branches", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  address: text("address").notNull(),
  gpsLatitude: decimal("gps_latitude", { precision: 10, scale: 7 }).notNull(),
  gpsLongitude: decimal("gps_longitude", { precision: 10, scale: 7 }).notNull(),
  gpsRadiusMeters: int("gps_radius_meters").notNull(),
  allowedIpCidr: varchar("allowed_ip_cidr", { length: 255 }).notNull(),
  registeredDeviceToken: varchar("registered_device_token", { length: 255 }),
  setupStatus: mysqlEnum("setup_status", ["setup_pending", "completed"]).notNull().default("setup_pending"),
  ...timestampColumns
}, (table) => [
  index("branches_name_idx").on(table.name)
]);

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

export const branchSetupLinks = mysqlTable("branch_setup_links", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branch_id").notNull().references(() => branches.id),
  token: varchar("token", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["active", "used", "revoked", "expired"]).notNull().default("active"),
  expiresAt: datetime("expires_at").notNull(),
  usedAt: datetime("used_at"),
  revokedAt: datetime("revoked_at"),
  createdByAdminId: int("created_by_admin_id").notNull().references(() => admins.id),
  ...timestampColumns
}, (table) => [
  uniqueIndex("branch_setup_links_token_uq").on(table.token),
  index("branch_setup_links_branch_id_idx").on(table.branchId)
]);

export const branchDeviceRegistrations = mysqlTable("branch_device_registrations", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branch_id").notNull().references(() => branches.id),
  deviceToken: varchar("device_token", { length: 255 }).notNull(),
  browserFingerprint: varchar("browser_fingerprint", { length: 255 }),
  status: mysqlEnum("status", ["pending", "active", "revoked", "replaced"]).notNull().default("pending"),
  registeredAt: datetime("registered_at"),
  revokedAt: datetime("revoked_at"),
  replacedAt: datetime("replaced_at"),
  ...timestampColumns
}, (table) => [
  uniqueIndex("branch_device_registrations_device_token_uq").on(table.deviceToken),
  index("branch_device_registrations_branch_id_idx").on(table.branchId)
]);

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
  index("weekly_day_off_assignments_week_start_date_idx").on(table.weekStartDate)
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

export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("admin_id").notNull().references(() => admins.id),
  actionType: varchar("action_type", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: varchar("entity_id", { length: 100 }).notNull(),
  entityDisplayName: varchar("entity_display_name", { length: 255 }),
  reason: text("reason"),
  beforeJson: json("before_json"),
  afterJson: json("after_json"),
  occurredAtUtc: datetime("occurred_at_utc").notNull(),
  ...timestampColumns
}, (table) => [
  index("audit_logs_admin_id_idx").on(table.adminId),
  index("audit_logs_entity_type_idx").on(table.entityType),
  index("audit_logs_occurred_at_utc_idx").on(table.occurredAtUtc)
]);
