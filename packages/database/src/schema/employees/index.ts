import { sql } from 'drizzle-orm';
import { check, decimal, int, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { branches } from '../organization/index.js';
export const employeeCodeSequence = mysqlTable('employee_code_sequence', { id: int('id').primaryKey(), nextCode: int('next_code').notNull() }, (table) => [check('employee_code_sequence_singleton', sql`${table.id} = 1`), check('employee_code_sequence_positive', sql`${table.nextCode} > 0`)]);
export const employees = mysqlTable('employees', {
  id: int('id').autoincrement().primaryKey(), employeeCode: int('employee_code').notNull(), fullName: varchar('full_name', { length: 255 }).notNull(),
  personalPhone: varchar('personal_phone', { length: 11 }).notNull(), whatsappPhone: varchar('whatsapp_phone', { length: 11 }).notNull(), pinHash: varchar('pin_hash', { length: 255 }).notNull(),
  credentialVersion: int('credential_version').notNull().default(1),
  age: int('age').notNull(), address: varchar('address', { length: 1000 }).notNull(), branchId: int('branch_id').notNull().references(() => branches.id),
  shiftDurationMinutes: int('shift_duration_minutes').notNull(), monthlyBaseSalary: decimal('monthly_base_salary', { precision: 12, scale: 2 }).notNull(),
  deletedAt: timestamp('deleted_at', { mode: 'date', fsp: 3 }), createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(), updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('employees_employee_code_unique').on(table.employeeCode),
  check('employees_age_positive', sql`${table.age} > 0`),
  check('employees_code_positive', sql`${table.employeeCode} > 0`),
  check('employees_personal_phone_format', sql`${table.personalPhone} regexp '^01[0125][0-9]{8}$'`),
  check('employees_whatsapp_phone_format', sql`${table.whatsappPhone} regexp '^01[0125][0-9]{8}$'`),
  check('employees_shift_duration_range', sql`${table.shiftDurationMinutes} between 1 and 720`),
  check('employees_salary_positive', sql`${table.monthlyBaseSalary} > 0`),
]);
export const employeeImages = mysqlTable('employee_images', {
  id: int('id').autoincrement().primaryKey(), employeeId: int('employee_id').notNull().references(() => employees.id), kind: mysqlEnum('kind', ['personal', 'idFront', 'idBack']).notNull(),
  storagePath: varchar('storage_path', { length: 500 }).notNull(), originalName: varchar('original_name', { length: 255 }).notNull(), mimeType: varchar('mime_type', { length: 100 }).notNull(), sizeBytes: int('size_bytes').notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(), updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [uniqueIndex('employee_images_employee_kind_unique').on(table.employeeId, table.kind), check('employee_images_size_range', sql`${table.sizeBytes} between 1 and 16777216`)]);
export const employeePhoneReservations = mysqlTable('employee_phone_reservations', {
  phone: varchar('phone', { length: 11 }).primaryKey(), employeeId: int('employee_id').notNull().references(() => employees.id),
});
