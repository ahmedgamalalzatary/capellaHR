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
import { timestampColumns } from "./columns";

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

export const branchSetupLinks = mysqlTable("branch_setup_links", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branch_id").notNull().references(() => branches.id),
  token: varchar("token", { length: 255 }).notNull(),
  deviceLabel: varchar("device_label", { length: 255 }),
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
  deviceLabel: varchar("device_label", { length: 255 }),
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
