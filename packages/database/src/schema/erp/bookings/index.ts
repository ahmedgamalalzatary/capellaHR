import {
  check,
  decimal,
  foreignKey,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

import { accounts } from '../../auth/index.js';
import { employees } from '../../employees/index.js';
import { branches } from '../../organization/index.js';
import { erpServices } from '../catalog/index.js';
import { clients } from '../clients/index.js';
import { cashierSessions, invoiceLines, invoices } from '../sales/index.js';
import { erpPaymentMethods } from '../sales/payment-methods.js';

export const erpBookingStatuses = [
  'booked', 'arrived', 'converted', 'cancelled', 'no_show',
] as const;

export const erpBookingServiceStatuses = ['pending', 'sold', 'cancelled'] as const;

export const erpBookingPaymentKinds = ['payment', 'refund'] as const;

export const erpBookingRefundCauses = [
  'service_cancelled', 'booking_cancelled', 'no_show', 'checkout_excess',
] as const;

export const erpBookings = mysqlTable('erp_bookings', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull().references(() => branches.id),
  clientId: int('client_id').notNull(),
  scheduledAt: timestamp('scheduled_at', { mode: 'date', fsp: 3 }).notNull(),
  status: mysqlEnum('status', erpBookingStatuses).notNull().default('booked'),
  note: varchar('note', { length: 1000 }),
  actingAccountId: int('acting_account_id').notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_bookings_client_branch_fk',
    columns: [table.clientId, table.branchId],
    foreignColumns: [clients.id, clients.branchId],
  }),
  foreignKey({
    name: 'erp_bookings_acting_account_fk',
    columns: [table.actingAccountId],
    foreignColumns: [accounts.id],
  }),
  uniqueIndex('erp_bookings_id_branch_unique').on(table.id, table.branchId),
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
  status: mysqlEnum('status', erpBookingServiceStatuses).notNull().default('pending'),
  invoiceId: int('invoice_id'),
  invoiceLineId: int('invoice_line_id'),
  changedAt: timestamp('changed_at', { mode: 'date', fsp: 3 }),
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
  foreignKey({
    name: 'erp_booking_services_invoice_branch_fk',
    columns: [table.invoiceId, table.branchId],
    foreignColumns: [invoices.id, invoices.branchId],
  }),
  foreignKey({
    name: 'erp_booking_services_invoice_line_fk',
    columns: [table.invoiceLineId],
    foreignColumns: [invoiceLines.id],
  }),
  uniqueIndex('erp_booking_services_booking_service_unique')
    .on(table.bookingId, table.serviceId),
  uniqueIndex('erp_booking_services_invoice_line_unique').on(table.invoiceLineId),
  index('erp_booking_services_preferred_employee_idx')
    .on(table.preferredEmployeeId, table.bookingId),
  check('erp_booking_services_sold_invoice_pair', sql`(${table.status} = 'sold') = (${table.invoiceId} is not null and ${table.invoiceLineId} is not null)`),
]);

export const erpBookingPayments = mysqlTable('erp_booking_payments', {
  id: int('id').autoincrement().primaryKey(),
  bookingId: int('booking_id').notNull(),
  branchId: int('branch_id').notNull(),
  kind: mysqlEnum('kind', erpBookingPaymentKinds).notNull(),
  method: mysqlEnum('method', erpPaymentMethods).notNull(),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  refundCause: mysqlEnum('refund_cause', erpBookingRefundCauses),
  cashierSessionId: int('cashier_session_id').notNull(),
  actingAccountId: int('acting_account_id').notNull(),
  operationReference: varchar('operation_reference', { length: 36 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'erp_booking_payments_booking_branch_fk',
    columns: [table.bookingId, table.branchId],
    foreignColumns: [erpBookings.id, erpBookings.branchId],
  }),
  foreignKey({
    name: 'erp_booking_payments_session_branch_fk',
    columns: [table.cashierSessionId, table.branchId],
    foreignColumns: [cashierSessions.id, cashierSessions.branchId],
  }),
  foreignKey({
    name: 'erp_booking_payments_account_fk',
    columns: [table.actingAccountId],
    foreignColumns: [accounts.id],
  }),
  uniqueIndex('erp_booking_payments_booking_reference_unique')
    .on(table.bookingId, table.operationReference),
  index('erp_booking_payments_session_created_idx').on(table.cashierSessionId, table.createdAt),
  index('erp_booking_payments_branch_created_idx').on(table.branchId, table.createdAt),
  check('erp_booking_payments_amount_positive', sql`${table.amount} > 0`),
  check('erp_booking_payments_refund_cause', sql`(${table.kind} = 'refund') = (${table.refundCause} is not null)`),
]);
