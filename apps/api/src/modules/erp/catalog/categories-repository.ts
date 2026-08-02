import { type createDatabase } from '@capella/database';
import { erpCategories } from '@capella/database/schema';
import { and, asc, count, eq, sql } from 'drizzle-orm';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import type { CategoryRecord, CategoryRepository } from './categories-service.js';

type Database = ReturnType<typeof createDatabase>;

export const CATALOG_AUDIT_MODULE = 'erp-catalog';

type CategoryRow = typeof erpCategories.$inferSelect;

/** `nameNormalized` is an internal duplicate-detection detail, not an API fact. */
const toRecord = (row: CategoryRow): CategoryRecord => ({
  id: row.id,
  branchId: row.branchId,
  type: row.type,
  name: row.name,
  isActive: row.isActive,
  hasEverBeenReferenced: row.hasEverBeenReferenced,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createDrizzleCategoryRepository = (
  database: Database,
  audit: ErpAuditCapability,
  now: () => Date = () => new Date(),
): CategoryRepository => ({
  async create(input) {
    return database.transaction(async (transaction) => {
      const createdAt = now();
      const result = await transaction.insert(erpCategories)
        .values({ ...input, createdAt, updatedAt: createdAt });
      const id = Number(result[0].insertId);
      const row = (await transaction.select().from(erpCategories)
        .where(eq(erpCategories.id, id)).limit(1))[0]!;
      const record = toRecord(row);
      await audit.record(transaction, {
        module: CATALOG_AUDIT_MODULE,
        action: 'create',
        entityType: 'category',
        entityId: id,
        afterState: record,
        relatedIds: { branchId: record.branchId },
        createdAt,
      });
      return record;
    });
  },

  async findById(id) {
    const row = (await database.select().from(erpCategories)
      .where(eq(erpCategories.id, id)).limit(1))[0];
    return row ? toRecord(row) : null;
  },

  async findByNormalizedName(branchId, type, nameNormalized) {
    const row = (await database.select().from(erpCategories).where(and(
      eq(erpCategories.branchId, branchId),
      eq(erpCategories.type, type),
      eq(erpCategories.nameNormalized, nameNormalized),
    )).limit(1))[0];
    return row ? toRecord(row) : null;
  },

  async list(branchId, query) {
    const filters = [eq(erpCategories.branchId, branchId)];
    if (query.type !== undefined) filters.push(eq(erpCategories.type, query.type));
    if (query.isActive !== undefined) filters.push(eq(erpCategories.isActive, query.isActive));
    // Search text is matched literally with locate(), never interpolated into a
    // LIKE pattern, so `%` and `_` typed by the admin stay ordinary characters.
    if (query.search) filters.push(sql`locate(${query.search}, ${erpCategories.name}) > 0`);
    const where = and(...filters);

    const rows = await database.select().from(erpCategories).where(where)
      .orderBy(asc(erpCategories.name), asc(erpCategories.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() }).from(erpCategories).where(where);
    return { items: rows.map(toRecord), total: totals[0]?.value ?? 0 };
  },

  async update(id, branchId, changes) {
    return database.transaction(async (transaction) => {
      // The branch is part of the lookup, so a category outside the acting
      // branch is invisible to the update rather than merely rejected after.
      const scope = and(eq(erpCategories.id, id), eq(erpCategories.branchId, branchId));
      const before = (await transaction.select().from(erpCategories)
        .where(scope).for('update').limit(1))[0];
      if (!before) return null;
      if (Object.keys(changes).length === 0) return toRecord(before);

      const updatedAt = now();
      await transaction.update(erpCategories).set({ ...changes, updatedAt }).where(scope);
      const after = toRecord((await transaction.select().from(erpCategories)
        .where(scope).limit(1))[0]!);
      await audit.record(transaction, {
        module: CATALOG_AUDIT_MODULE,
        action: 'update',
        entityType: 'category',
        entityId: id,
        beforeState: toRecord(before),
        afterState: after,
        relatedIds: { branchId },
        createdAt: updatedAt,
      });
      return after;
    });
  },

  async delete(id, branchId) {
    return database.transaction(async (transaction) => {
      const scope = and(eq(erpCategories.id, id), eq(erpCategories.branchId, branchId));
      const before = (await transaction.select().from(erpCategories)
        .where(scope).for('update').limit(1))[0];
      if (!before) return 'missing';
      // The flag is permanent, so a category that ever carried a service (and,
      // from ERP 15, an expense) can never be deleted — only deactivated.
      if (before.hasEverBeenReferenced) return 'referenced';

      const deletedAt = now();
      await transaction.delete(erpCategories).where(scope);
      await audit.record(transaction, {
        module: CATALOG_AUDIT_MODULE,
        action: 'delete',
        entityType: 'category',
        entityId: id,
        beforeState: toRecord(before),
        relatedIds: { branchId },
        createdAt: deletedAt,
      });
      return 'deleted';
    });
  },
});

/**
 * Marks a category permanently referenced inside the caller's transaction. Kept
 * next to the category rows it locks so every future referencing module (ERP 15
 * expenses) uses the same lock order as service creation.
 */
export const markCategoryReferenced = async (
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  categoryId: number,
  now: Date,
) => {
  const before = (await transaction.select().from(erpCategories)
    .where(eq(erpCategories.id, categoryId)).for('update').limit(1))[0];
  if (!before || before.hasEverBeenReferenced) return;
  await transaction.update(erpCategories)
    .set({ hasEverBeenReferenced: true, updatedAt: now })
    .where(eq(erpCategories.id, categoryId));
};
