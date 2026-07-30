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
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { employees } from '../employees/index.js';

export const accounts = mysqlTable('accounts', {
  id: int('id').autoincrement().primaryKey(),
  username: varchar('username', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: mysqlEnum('role', ['admin', 'cashier']).notNull(),
  employeeId: int('employee_id').references(() => employees.id),
  adminSingleton: int('admin_singleton')
    .generatedAlwaysAs(sql`case when ${sql.raw('role')} = 'admin' then 1 else null end`, { mode: 'stored' }),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('accounts_username_unique').on(table.username),
  uniqueIndex('accounts_employee_unique').on(table.employeeId),
  uniqueIndex('accounts_admin_singleton_unique').on(table.adminSingleton),
  check(
    'accounts_role_scope_consistency',
    sql`(${table.role} = 'admin' and ${table.employeeId} is null) or (${table.role} = 'cashier' and ${table.employeeId} is not null)`,
  ),
]);

export const authSessions = mysqlTable('auth_sessions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  actorType: mysqlEnum('actor_type', ['admin', 'employee', 'account']).notNull(),
  employeeId: int('employee_id').references(() => employees.id),
  accountId: int('account_id').references(() => accounts.id),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date', fsp: 3 }).notNull()
    .$defaultFn(() => new Date(Date.now() + 24 * 60 * 60_000)),
  revokedAt: timestamp('revoked_at', { mode: 'date', fsp: 3 }),
}, (table) => [
  index('auth_sessions_employee_active_idx').on(table.employeeId, table.revokedAt),
  index('auth_sessions_account_active_idx').on(table.accountId, table.revokedAt),
  check(
    'auth_sessions_actor_identity_consistency',
    sql`(${table.actorType} = 'admin' and ${table.employeeId} is null and ${table.accountId} is null)
      or (${table.actorType} = 'employee' and ${table.employeeId} is not null and ${table.accountId} is null)
      or (${table.actorType} = 'account' and ${table.employeeId} is null and ${table.accountId} is not null)`,
  ),
]);

export const authAttempts = mysqlTable('auth_attempts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  actorType: mysqlEnum('actor_type', ['admin', 'employee', 'account']).notNull(),
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
  index('auth_attempts_ip_actor_created_idx').on(table.ipAddress, table.actorType, table.createdAt),
  index('auth_attempts_flagged_created_idx').on(table.flagged, table.createdAt),
]);

export const authLoginLimits = mysqlTable('auth_login_limits', {
  key: varchar('key', { length: 66 }).primaryKey(),
  attemptCount: int('attempt_count').notNull().default(0),
  version: int('version').notNull().default(0),
  windowStartedAt: timestamp('window_started_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  index('auth_login_limits_updated_idx').on(table.updatedAt),
  check('auth_login_limits_attempt_count_nonnegative', sql`${table.attemptCount} >= 0`),
  check('auth_login_limits_version_nonnegative', sql`${table.version} >= 0`),
]);
