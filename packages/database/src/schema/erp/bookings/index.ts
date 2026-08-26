import {
  foreignKey,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { accounts } from '../../auth/index.js';
import { employees } from '../../employees/index.js';
import { branches } from '../../organization/index.js';
import { erpServices } from '../catalog/index.js';
import { clients } from '../clients/index.js';
import { invoices } from '../sales/index.js';

export const erpBookingStatuses = [
  'booked', 'arrived', 'converted', 'cancelled', 'no_show',
] as const;

export const erpBookings = mysqlTable('erp_bookings', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull().references(() => branches.id),
  clientId: int('client_id').notNull(),
  scheduledAt: timestamp('scheduled_at', { mode: 'date', fsp: 3 }).notNull(),
  status: mysqlEnum('status', erpBookingStatuses).notNull().default('booked'),
  note: varchar('note', { length: 1000 }),
  actingAccountId: int('acting_account_id').notNull().references(() => accounts.id),
  invoiceId: int('invoice_id'),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_bookings_client_branch_fk',
    columns: [table.clientId, table.branchId],
    foreignColumns: [clients.id, clients.branchId],
  }),
  foreignKey({
    name: 'erp_bookings_invoice_branch_fk',
    columns: [table.invoiceId, table.branchId],
    foreignColumns: [invoices.id, invoices.branchId],
  }),
  uniqueIndex('erp_bookings_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('erp_bookings_invoice_unique').on(table.invoiceId),
  index('erp_bookings_branch_scheduled_idx').on(table.branchId, table.scheduledAt),
  index('erp_bookings_branch_status_scheduled_idx')
    .on(table.branchId, table.status, table.scheduledAt),
]);

export const erpBookingServices = mysqlTable('erp_booking_services', {
  id: int('id').autoincrement().primaryKey(),
  bookingId: int('booking_id').notNull(),
  branchId: int('branch_id').notNull(),
  serviceId: int('service_id').notNull(),
  preferredEmployeeId: int('preferred_employee_id'),
}, (table) => [
  foreignKey({
    name: 'erp_booking_services_booking_branch_fk',
    columns: [table.bookingId, table.branchId],
    foreignColumns: [erpBookings.id, erpBookings.branchId],
  }),
  foreignKey({
    name: 'erp_booking_services_service_branch_fk',
    columns: [table.serviceId, table.branchId],
    foreignColumns: [erpServices.id, erpServices.branchId],
  }),
  foreignKey({
    name: 'erp_booking_services_preferred_employee_branch_fk',
    columns: [table.preferredEmployeeId, table.branchId],
    foreignColumns: [employees.id, employees.branchId],
  }),
  uniqueIndex('erp_booking_services_booking_service_unique')
    .on(table.bookingId, table.serviceId),
  index('erp_booking_services_preferred_employee_idx')
    .on(table.preferredEmployeeId, table.bookingId),
]);
