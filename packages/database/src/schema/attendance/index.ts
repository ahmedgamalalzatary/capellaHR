import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  double,
  foreignKey,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { devices } from '../devices/index.js';
import { employees } from '../employees/index.js';

const attendanceEventSources = [
  'personal_device',
  'branch_device',
  'admin_manual',
  'admin_approved_denied',
  'automatic_timeout',
] as const;

export const attendanceSessions = mysqlTable('attendance_sessions', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  attendanceDate: date('attendance_date', { mode: 'string' }).notNull(),
  requiredMinutes: int('required_minutes').notNull(),
  checkInAt: timestamp('check_in_at', { mode: 'date', fsp: 3 }).notNull(),
  checkOutAt: timestamp('check_out_at', { mode: 'date', fsp: 3 }),
  openEmployeeId: int('open_employee_id')
    .generatedAlwaysAs(sql`case when check_out_at is null then employee_id else null end`, { mode: 'stored' }),
  workedMinutes: int('worked_minutes'),
  overtimeMinutes: int('overtime_minutes'),
  shortageMinutes: int('shortage_minutes'),
  automaticTimeoutAt: timestamp('automatic_timeout_at', { mode: 'date', fsp: 3 }),
  automaticTimeoutCorrectedAt: timestamp('automatic_timeout_corrected_at', { mode: 'date', fsp: 3 }),
  flagged: boolean('flagged').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('attendance_sessions_employee_date_unique')
    .on(table.employeeId, table.attendanceDate),
  uniqueIndex('attendance_sessions_id_employee_date_unique')
    .on(table.id, table.employeeId, table.attendanceDate),
  uniqueIndex('attendance_sessions_open_employee_unique').on(table.openEmployeeId),
  check(
    'attendance_sessions_required_minutes_range',
    sql`${table.requiredMinutes} between 1 and 720`,
  ),
  check(
    'attendance_sessions_checkout_state',
    sql`(${table.checkOutAt} is null and ${table.workedMinutes} is null and ${table.overtimeMinutes} is null and ${table.shortageMinutes} is null) or (${table.checkOutAt} is not null and ${table.checkOutAt} > ${table.checkInAt} and ${table.workedMinutes} >= 0 and ${table.overtimeMinutes} >= 0 and ${table.shortageMinutes} >= 0)`,
  ),
]);

export const attendanceJobs = mysqlTable('attendance_jobs', {
  id: int('id').autoincrement().primaryKey(),
  jobType: mysqlEnum('job_type', ['automatic_timeout', 'absence_generation']).notNull(),
  sessionId: int('session_id').references(() => attendanceSessions.id),
  attendanceDate: date('attendance_date', { mode: 'string' }),
  status: mysqlEnum('status', ['scheduled', 'processing', 'completed', 'failed'])
    .notNull().default('scheduled'),
  runAt: timestamp('run_at', { mode: 'date', fsp: 3 }).notNull(),
  attemptCount: int('attempt_count').notNull().default(0),
  lastError: varchar('last_error', { length: 1000 }),
  startedAt: timestamp('started_at', { mode: 'date', fsp: 3 }),
  completedAt: timestamp('completed_at', { mode: 'date', fsp: 3 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('attendance_jobs_session_unique').on(table.sessionId),
  uniqueIndex('attendance_jobs_absence_date_unique').on(table.attendanceDate),
  index('attendance_jobs_claim_idx').on(table.status, table.runAt, table.id),
  check('attendance_jobs_attempt_count_nonnegative', sql`${table.attemptCount} >= 0`),
  check(
    'attendance_jobs_payload_state',
    sql`(${table.jobType} = 'automatic_timeout' and ${table.sessionId} is not null and ${table.attendanceDate} is null) or (${table.jobType} = 'absence_generation' and ${table.sessionId} is null and ${table.attendanceDate} is not null)`,
  ),
  check(
    'attendance_jobs_execution_state',
    sql`(${table.status} = 'scheduled' and ${table.startedAt} is null and ${table.completedAt} is null) or (${table.status} = 'processing' and ${table.startedAt} is not null and ${table.completedAt} is null) or (${table.status} = 'completed' and ${table.completedAt} is not null) or (${table.status} = 'failed' and ${table.startedAt} is not null and ${table.completedAt} is null and ${table.lastError} is not null)`,
  ),
]);

export const attendanceDailyRecords = mysqlTable('attendance_daily_records', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  attendanceDate: date('attendance_date', { mode: 'string' }).notNull(),
  status: mysqlEnum('status', ['absence', 'weekly_day_off', 'attendance_replaced']).notNull().default('absence'),
  absenceRequiredMinutes: int('absence_required_minutes').notNull(),
  dayOffConvertedAt: timestamp('day_off_converted_at', { mode: 'date', fsp: 3 }),
  replacedBySessionId: int('replaced_by_session_id'),
  replacedAt: timestamp('replaced_at', { mode: 'date', fsp: 3 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('attendance_daily_records_employee_date_unique')
    .on(table.employeeId, table.attendanceDate),
  index('attendance_daily_records_status_date_idx').on(table.status, table.attendanceDate),
  foreignKey({
    columns: [table.replacedBySessionId, table.employeeId, table.attendanceDate],
    foreignColumns: [attendanceSessions.id, attendanceSessions.employeeId, attendanceSessions.attendanceDate],
    name: 'attendance_daily_records_replaced_owner_fk',
  }),
  check(
    'attendance_daily_records_required_minutes_range',
    sql`${table.absenceRequiredMinutes} between 1 and 720`,
  ),
  check(
    'attendance_daily_records_conversion_state',
    sql`(${table.status} = 'absence' and ${table.dayOffConvertedAt} is null and ${table.replacedBySessionId} is null and ${table.replacedAt} is null) or (${table.status} = 'weekly_day_off' and ${table.dayOffConvertedAt} is not null and ${table.replacedBySessionId} is null and ${table.replacedAt} is null) or (${table.status} = 'attendance_replaced' and ${table.dayOffConvertedAt} is null and ${table.replacedBySessionId} is not null and ${table.replacedAt} is not null)`,
  ),
]);

export const attendanceDeniedAttempts = mysqlTable('attendance_denied_attempts', {
  id: int('id').autoincrement().primaryKey(),
  eventType: mysqlEnum('event_type', ['check_in', 'check_out']).notNull(),
  claimedEmployeeCode: int('claimed_employee_code').notNull(),
  employeeId: int('employee_id').references(() => employees.id),
  source: mysqlEnum('source', ['personal_device', 'branch_device']).notNull(),
  deviceId: int('device_id').references(() => devices.id),
  occurredAt: timestamp('occurred_at', { mode: 'date', fsp: 3 }).notNull(),
  latitude: double('latitude'),
  longitude: double('longitude'),
  gpsAccuracyMeters: double('gps_accuracy_meters'),
  distanceMeters: double('distance_meters'),
  branchLatitude: double('branch_latitude'),
  branchLongitude: double('branch_longitude'),
  branchRadiusMeters: double('branch_radius_meters'),
  failureReason: varchar('failure_reason', { length: 64 }).notNull(),
  suspicious: boolean('suspicious').notNull().default(false),
  approvedAt: timestamp('approved_at', { mode: 'date', fsp: 3 }),
  approvedSessionId: int('approved_session_id'),
  dismissedAt: timestamp('dismissed_at', { mode: 'date', fsp: 3 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('attendance_denied_attempts_id_owner_type_unique')
    .on(table.id, table.employeeId, table.eventType),
  index('attendance_denied_attempts_employee_date_idx').on(table.employeeId, table.occurredAt),
  index('attendance_denied_attempts_review_idx').on(table.approvedAt, table.suspicious),
  foreignKey({
    columns: [table.approvedSessionId, table.employeeId],
    foreignColumns: [attendanceSessions.id, attendanceSessions.employeeId],
    name: 'attendance_denied_attempts_approved_owner_fk',
  }),
  check('attendance_denied_attempts_code_positive', sql`${table.claimedEmployeeCode} > 0`),
  check(
    'attendance_denied_attempts_approval_state',
    sql`(${table.approvedAt} is null and ${table.approvedSessionId} is null and ${table.dismissedAt} is null) or (${table.approvedAt} is not null and ${table.approvedSessionId} is not null and ${table.employeeId} is not null and ${table.dismissedAt} is null) or (${table.approvedAt} is null and ${table.approvedSessionId} is null and ${table.dismissedAt} is not null)`,
  ),
]);

export const attendanceEvents = mysqlTable('attendance_events', {
  id: int('id').autoincrement().primaryKey(),
  sessionId: int('session_id').notNull(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  eventType: mysqlEnum('event_type', ['check_in', 'check_out']).notNull(),
  source: mysqlEnum('source', attendanceEventSources).notNull(),
  deviceId: int('device_id').references(() => devices.id),
  occurredAt: timestamp('occurred_at', { mode: 'date', fsp: 3 }).notNull(),
  latitude: double('latitude'),
  longitude: double('longitude'),
  gpsAccuracyMeters: double('gps_accuracy_meters'),
  distanceMeters: double('distance_meters'),
  branchLatitude: double('branch_latitude'),
  branchLongitude: double('branch_longitude'),
  branchRadiusMeters: double('branch_radius_meters'),
  approvedDeniedAttemptId: int('approved_denied_attempt_id'),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('attendance_events_session_type_unique').on(table.sessionId, table.eventType),
  index('attendance_events_employee_occurred_idx').on(table.employeeId, table.occurredAt),
  foreignKey({
    columns: [table.approvedDeniedAttemptId, table.employeeId, table.eventType],
    foreignColumns: [
      attendanceDeniedAttempts.id,
      attendanceDeniedAttempts.employeeId,
      attendanceDeniedAttempts.eventType,
    ],
    name: 'attendance_events_approved_attempt_owner_fk',
  }),
  foreignKey({
    columns: [table.sessionId, table.employeeId],
    foreignColumns: [attendanceSessions.id, attendanceSessions.employeeId],
    name: 'attendance_events_session_owner_fk',
  }),
  check(
    'attendance_events_approval_source_state',
    sql`(${table.source} = 'admin_approved_denied' and ${table.approvedDeniedAttemptId} is not null) or (${table.source} <> 'admin_approved_denied' and ${table.approvedDeniedAttemptId} is null)`,
  ),
]);
