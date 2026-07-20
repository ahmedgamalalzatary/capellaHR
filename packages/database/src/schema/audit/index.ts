import {
  bigint,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core';

export const auditEvents = mysqlTable('audit_events', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  actorType: mysqlEnum('actor_type', ['admin', 'employee', 'system']).notNull(),
  actorIdentifier: varchar('actor_identifier', { length: 128 }).notNull(),
  action: varchar('action', { length: 64 }).notNull(),
  module: varchar('module', { length: 64 }).notNull(),
  entityType: varchar('entity_type', { length: 64 }).notNull(),
  entityId: varchar('entity_id', { length: 128 }).notNull(),
  beforeState: json('before_state'),
  afterState: json('after_state'),
  relatedIds: json('related_ids').$type<Record<string, string>>(),
  requestId: varchar('request_id', { length: 64 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: varchar('user_agent', { length: 1024 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  index('audit_events_created_idx').on(table.createdAt, table.id),
  index('audit_events_module_action_idx').on(table.module, table.action, table.createdAt),
  index('audit_events_actor_idx').on(table.actorType, table.actorIdentifier, table.createdAt),
  index('audit_events_entity_idx').on(table.entityType, table.entityId, table.createdAt),
  index('audit_events_request_idx').on(table.requestId),
]);
