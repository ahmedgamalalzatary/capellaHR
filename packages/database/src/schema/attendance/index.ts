import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';

import { employees } from '../employees/index.js';

export const attendanceDailyRecords = mysqlTable('attendance_daily_records', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  attendanceDate: date('attendance_date', { mode: 'string' }).notNull(),
  status: mysqlEnum('status', ['absence', 'weekly_day_off']).notNull().default('absence'),
  absenceRequiredMinutes: int('absence_required_minutes').notNull(),
  dayOffConvertedAt: timestamp('day_off_converted_at', { mode: 'date', fsp: 3 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('attendance_daily_records_employee_date_unique')
    .on(table.employeeId, table.attendanceDate),
  index('attendance_daily_records_status_date_idx').on(table.status, table.attendanceDate),
  check(
    'attendance_daily_records_required_minutes_range',
    sql`${table.absenceRequiredMinutes} between 1 and 720`,
  ),
  check(
    'attendance_daily_records_conversion_state',
    sql`(${table.status} = 'absence' and ${table.dayOffConvertedAt} is null) or (${table.status} = 'weekly_day_off' and ${table.dayOffConvertedAt} is not null)`,
  ),
]);
