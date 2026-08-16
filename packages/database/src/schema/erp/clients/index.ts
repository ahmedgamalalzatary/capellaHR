import { sql } from 'drizzle-orm';
import { check, index, int, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { branches } from '../../organization/index.js';

/**
 * Clients are branch-scoped: the same person visiting two branches is two
 * records, matching the rule that every ERP business record belongs to one
 * branch. Phone is the POS lookup key and, when present, is stored already
 * normalized to the locked 11-digit Egyptian mobile form, so the uniqueness
 * index and the format check both operate on the canonical value. Name and
 * phone are each optional on their own — MySQL lets a unique index hold many
 * NULLs, so any number of clients may be recorded without a number.
 *
 * There is deliberately no delete operation and no soft-delete column: invoices
 * mandate a client reference, so preserving clients referenced by historical
 * invoices is achieved by never removing them.
 */
export const clients = mysqlTable('clients', {
  id: int('id').autoincrement().primaryKey(),
  branchId: int('branch_id').notNull().references(() => branches.id),
  fullName: varchar('full_name', { length: 255 }),
  phone: varchar('phone', { length: 11 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('clients_id_branch_unique').on(table.id, table.branchId),
  uniqueIndex('clients_branch_phone_unique').on(table.branchId, table.phone),
  index('clients_branch_name_idx').on(table.branchId, table.fullName),
  check('clients_phone_format', sql`${table.phone} regexp '^01[0125][0-9]{8}$'`),
  // A walk-in may be only a name and a booking only a number, but a row with
  // neither names nobody and could never be found again.
  check(
    'clients_identity_present',
    sql`${table.fullName} is not null or ${table.phone} is not null`,
  ),
]);
