import { sql } from 'drizzle-orm';
import { check, foreignKey, index, int, mysqlEnum, mysqlTable, timestamp, uniqueIndex } from 'drizzle-orm/mysql-core';

import { erpProducts } from '../catalog/index.js';
import { branches } from '../../organization/index.js';

export const erpBranchLinkStates = ['pending', 'active'] as const;
export const erpProductLinkStates = ['linked', 'excluded'] as const;

/**
 * One branch feeding another: products flow sender ⇒ receiver only. The row is
 * `pending` while the first setup is still being settled, and nothing syncs
 * until an admin activates it. A sender may feed many receivers; a receiver is
 * fed by exactly one sender (the rules are enforced when links are written).
 */
export const erpBranchLinks = mysqlTable('erp_branch_links', {
  id: int('id').autoincrement().primaryKey(),
  senderBranchId: int('sender_branch_id').notNull(),
  receiverBranchId: int('receiver_branch_id').notNull(),
  state: mysqlEnum('state', erpBranchLinkStates).notNull().default('pending'),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_branch_links_sender_fk', columns: [table.senderBranchId], foreignColumns: [branches.id] }),
  foreignKey({ name: 'erp_branch_links_receiver_fk', columns: [table.receiverBranchId], foreignColumns: [branches.id] }),
  uniqueIndex('erp_branch_links_pair_unique').on(table.senderBranchId, table.receiverBranchId),
  check('erp_branch_links_distinct', sql`${table.senderBranchId} <> ${table.receiverBranchId}`),
]);

/**
 * What one sender product is to the receiving branch. `linked` names the
 * receiving product; `excluded` says there is no receiving product (the admin
 * chose "don't copy" or "not the same item", which also records the product it
 * was compared with so a transfer never lands on it).
 *
 * The receiver side is unique only when it is set: MySQL allows many nulls, so
 * a sender product can own several exclusion rows without colliding.
 */
export const erpProductLinks = mysqlTable('erp_product_links', {
  id: int('id').autoincrement().primaryKey(),
  senderBranchId: int('sender_branch_id').notNull(),
  receiverBranchId: int('receiver_branch_id').notNull(),
  senderProductId: int('sender_product_id').notNull(),
  receiverProductId: int('receiver_product_id'),
  state: mysqlEnum('state', erpProductLinkStates).notNull(),
  notSameAsProductId: int('not_same_as_product_id'),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({ name: 'erp_product_links_sender_product_fk', columns: [table.senderProductId], foreignColumns: [erpProducts.id] }),
  foreignKey({ name: 'erp_product_links_receiver_product_fk', columns: [table.receiverProductId], foreignColumns: [erpProducts.id] }),
  foreignKey({ name: 'erp_product_links_not_same_product_fk', columns: [table.notSameAsProductId], foreignColumns: [erpProducts.id] }),
  uniqueIndex('erp_product_links_sender_unique').on(table.senderBranchId, table.receiverBranchId, table.senderProductId),
  uniqueIndex('erp_product_links_receiver_unique').on(table.senderBranchId, table.receiverBranchId, table.receiverProductId),
  index('erp_product_links_sender_product_idx').on(table.senderProductId),
  index('erp_product_links_receiver_product_idx').on(table.receiverProductId),
]);
