import { sql } from 'drizzle-orm';
import { bigint, boolean, check, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { employees } from '../employees/index.js';
import { branches } from '../organization/index.js';

export const devices = mysqlTable('devices', {
  id: int('id').autoincrement().primaryKey(),
  assignmentType: mysqlEnum('assignment_type', ['employee', 'branch']).notNull(),
  employeeId: int('employee_id').references(() => employees.id), branchId: int('branch_id').references(() => branches.id),
  credentialId: varchar('credential_id', { length: 4096 }).notNull(),
  credentialIdHash: varchar('credential_id_hash', { length: 64 }).notNull(),
  credentialPublicKey: text('public_key').notNull(),
  counter: bigint('counter', { mode: 'number', unsigned: true }).notNull().default(0),
  transports: json('transports').$type<string[]>().notNull(),
  credentialDeviceType: mysqlEnum('credential_device_type', ['singleDevice', 'multiDevice']).notNull(),
  credentialBackedUp: boolean('credential_backed_up').notNull(),
  installationMarkerHash: varchar('installation_marker_hash', { length: 64 }),
  browser: varchar('browser', { length: 255 }).notNull(), platform: varchar('platform', { length: 255 }).notNull(),
  status: mysqlEnum('status', ['active', 'revoked']).notNull().default('active'),
  pairedAt: timestamp('paired_at', { mode: 'date', fsp: 3 }).notNull(), lastUsedAt: timestamp('last_used_at', { mode: 'date', fsp: 3 }), revokedAt: timestamp('revoked_at', { mode: 'date', fsp: 3 }),
}, (table) => [
  uniqueIndex('devices_credential_hash_unique').on(table.credentialIdHash),
  uniqueIndex('devices_installation_marker_hash_unique').on(table.installationMarkerHash),
  check('devices_exact_assignment', sql`(${table.assignmentType} = 'employee' and ${table.employeeId} is not null and ${table.branchId} is null) or (${table.assignmentType} = 'branch' and ${table.branchId} is not null and ${table.employeeId} is null)`),
]);

export const devicePairingRequests = mysqlTable('device_pairing_requests', {
  id: int('id').autoincrement().primaryKey(), assignmentType: mysqlEnum('assignment_type', ['employee', 'branch']).notNull(),
  employeeId: int('employee_id').references(() => employees.id), branchId: int('branch_id').references(() => branches.id),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(), status: mysqlEnum('status', ['pending', 'used', 'cancelled']).notNull().default('pending'),
  registrationChallenge: varchar('registration_challenge', { length: 512 }),
  webauthnUserId: varchar('webauthn_user_id', { length: 128 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(), consumedAt: timestamp('consumed_at', { mode: 'date', fsp: 3 }), cancelledAt: timestamp('cancelled_at', { mode: 'date', fsp: 3 }),
}, (table) => [uniqueIndex('device_pairing_token_hash_unique').on(table.tokenHash), check('device_pairings_exact_assignment', sql`(${table.assignmentType} = 'employee' and ${table.employeeId} is not null and ${table.branchId} is null) or (${table.assignmentType} = 'branch' and ${table.branchId} is not null and ${table.employeeId} is null)`) ]);

export const deviceAuthenticationChallenges = mysqlTable('device_authentication_challenges', {
  id: varchar('id', { length: 36 }).primaryKey(),
  deviceId: int('device_id').notNull().references(() => devices.id),
  challenge: varchar('challenge', { length: 512 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  consumedAt: timestamp('consumed_at', { mode: 'date', fsp: 3 }),
});

export const deviceHistory = mysqlTable('device_history', {
  id: int('id').autoincrement().primaryKey(), deviceId: int('device_id').notNull().references(() => devices.id),
  event: mysqlEnum('event', ['paired', 'verified', 'revoked']).notNull(), createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
});
