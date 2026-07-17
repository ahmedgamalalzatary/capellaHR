export {};
import { boolean, double, int, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

export const branches = mysqlTable('branches', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  nameNormalized: varchar('name_normalized', { length: 255 }).notNull(),
  location: varchar('location', { length: 1000 }).notNull(),
  latitude: double('latitude').notNull(),
  longitude: double('longitude').notNull(),
  gpsAccuracyMeters: double('gps_accuracy_meters').notNull(),
  attendanceRadiusMeters: double('attendance_radius_meters').notNull(),
  hasEverBeenReferenced: boolean('has_ever_been_referenced').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [uniqueIndex('branches_name_normalized_unique').on(table.nameNormalized)]);
