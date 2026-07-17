export {};
import { sql } from 'drizzle-orm';
import { boolean, check, double, int, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

export const branches = mysqlTable('branches', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  nameNormalized: varchar('name_normalized', { length: 64 }).notNull(),
  location: varchar('location', { length: 1000 }).notNull(),
  latitude: double('latitude').notNull(),
  longitude: double('longitude').notNull(),
  gpsAccuracyMeters: double('gps_accuracy_meters').notNull(),
  attendanceRadiusMeters: double('attendance_radius_meters').notNull(),
  hasEverBeenReferenced: boolean('has_ever_been_referenced').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('branches_name_normalized_unique').on(table.nameNormalized),
  check('branches_latitude_range', sql`${table.latitude} between -90 and 90`),
  check('branches_longitude_range', sql`${table.longitude} between -180 and 180`),
  check('branches_accuracy_nonnegative', sql`${table.gpsAccuracyMeters} >= 0`),
  check('branches_radius_positive', sql`${table.attendanceRadiusMeters} > 0`),
]);
