import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core';

const reportTypes = [
  'branches', 'employees', 'devices', 'shifts', 'weekly-day-off',
  'attendance', 'payroll', 'bonuses', 'deductions', 'advances',
] as const;

export const reportExports = mysqlTable('report_exports', {
  id: int('id').autoincrement().primaryKey(),
  reportType: mysqlEnum('report_type', reportTypes).notNull(),
  status: mysqlEnum('status', ['queued', 'processing', 'completed', 'failed']).notNull().default('queued'),
  filters: json('filters').$type<Record<string, unknown>>().notNull(),
  selection: json('selection').$type<Record<string, unknown>>().notNull(),
  filePath: varchar('file_path', { length: 500 }),
  fileSha256: varchar('file_sha256', { length: 64 }),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number', unsigned: true }),
  rowCount: int('row_count'),
  attemptCount: int('attempt_count').notNull().default(0),
  cycleAttemptCount: int('cycle_attempt_count').notNull().default(0),
  retryCount: int('retry_count').notNull().default(0),
  failureReason: text('failure_reason'),
  queuedAt: timestamp('queued_at', { mode: 'date', fsp: 3 }).notNull(),
  startedAt: timestamp('started_at', { mode: 'date', fsp: 3 }),
  completedAt: timestamp('completed_at', { mode: 'date', fsp: 3 }),
  failedAt: timestamp('failed_at', { mode: 'date', fsp: 3 }),
  fileDeletedAt: timestamp('file_deleted_at', { mode: 'date', fsp: 3 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  index('report_exports_status_queue_idx').on(table.status, table.queuedAt, table.id),
  index('report_exports_type_created_idx').on(table.reportType, table.createdAt),
  check('report_exports_attempt_count_nonnegative', sql`${table.attemptCount} >= 0`),
  check('report_exports_cycle_attempt_count_bounded', sql`${table.cycleAttemptCount} >= 0 and ${table.cycleAttemptCount} <= 3`),
  check('report_exports_retry_count_nonnegative', sql`${table.retryCount} >= 0`),
  check('report_exports_row_count_nonnegative', sql`${table.rowCount} is null or ${table.rowCount} >= 0`),
]);
