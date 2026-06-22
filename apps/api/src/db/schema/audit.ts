import {
  datetime,
  index,
  int,
  json,
  mysqlTable,
  text,
  varchar
} from "drizzle-orm/mysql-core";
import { admins } from "./auth";
import { timestampColumns } from "./columns";

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
