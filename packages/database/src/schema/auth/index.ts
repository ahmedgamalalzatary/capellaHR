import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core';
import { employees } from '../employees/index.js';

export const adminCredentials = mysqlTable('admin_credentials', {
  id: int('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  // Single-admin system: the table can only ever hold the singleton row.
  check('admin_credentials_singleton', sql`${table.id} = 1`),
]);

export const authSessions = mysqlTable('auth_sessions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  actorType: mysqlEnum('actor_type', ['admin', 'employee']).notNull(),
  employeeId: int('employee_id').references(() => employees.id),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  revokedAt: timestamp('revoked_at', { mode: 'date', fsp: 3 }),
}, (table) => [
  index('auth_sessions_employee_active_idx').on(table.employeeId, table.revokedAt),
  check('auth_sessions_actor_employee_consistency', sql`(${table.actorType} = 'admin' and ${table.employeeId} is null) or (${table.actorType} = 'employee' and ${table.employeeId} is not null)`),
]);

export const authAttempts = mysqlTable('auth_attempts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  actorType: mysqlEnum('actor_type', ['admin', 'employee']).notNull(),
  identifier: varchar('identifier', { length: 255 }).notNull(),
  succeeded: boolean('succeeded').notNull(),
  flagged: boolean('flagged').notNull(),
  reason: varchar('reason', { length: 64 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: varchar('user_agent', { length: 1024 }),
  requestId: varchar('request_id', { length: 64 }),
  metadata: json('metadata'),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  index('auth_attempts_identifier_created_idx').on(table.identifier, table.createdAt),
  index('auth_attempts_flagged_created_idx').on(table.flagged, table.createdAt),
]);
