import { type createDatabase } from '@capella/database';
import { branches } from '@capella/database/schema';
import { and, asc, count, eq, or, sql } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import type { BranchRepository } from './branches-service.js';

type Database = ReturnType<typeof createDatabase>;

const isReferencedRowError = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false;
  const hasReferencedCode = (value: object) => (Reflect.get(value, 'code') as unknown) === 'ER_ROW_IS_REFERENCED_2'
    || (Reflect.get(value, 'errno') as unknown) === 1451;
  const cause = Reflect.get(error, 'cause') as unknown;
  return hasReferencedCode(error)
    || (typeof cause === 'object' && cause !== null && hasReferencedCode(cause));
};

export const createDrizzleBranchRepository = (database: Database, now: () => Date = () => new Date()): BranchRepository => ({
  async create(input) {
    return database.transaction(async (transaction) => {
      const createdAt = now();
      const result = await transaction.insert(branches).values({ ...input, createdAt, updatedAt: createdAt });
      const id = Number(result[0].insertId);
      const record = (await transaction.select().from(branches).where(eq(branches.id, id)).limit(1))[0]!;
      await writeAudit(transaction, {
        module: 'branches', action: 'create', entityType: 'branch', entityId: id,
        afterState: record, createdAt,
      });
      return record;
    });
  },
  async findById(id) {
    return (await database.select().from(branches).where(eq(branches.id, id)).limit(1))[0] ?? null;
  },
  async findByNormalizedName(name) {
    return (await database.select({ id: branches.id }).from(branches).where(eq(branches.nameNormalized, name)).limit(1))[0] ?? null;
  },
  async list(query) {
    const where = query.search ? or(
      sql`locate(${query.search}, ${branches.name}) > 0`,
      sql`locate(${query.search}, ${branches.location}) > 0`,
    ) : undefined;
    const items = await database.select().from(branches).where(where).orderBy(asc(branches.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() }).from(branches).where(where);
    return { items, total: totals[0]?.value ?? 0 };
  },
  async update(id, input) {
    return database.transaction(async (transaction) => {
      const before = (await transaction.select().from(branches).where(eq(branches.id, id)).for('update').limit(1))[0];
      if (!before) return null;
      const updatedAt = now();
      await transaction.update(branches).set({ ...input, updatedAt }).where(eq(branches.id, id));
      const after = (await transaction.select().from(branches).where(eq(branches.id, id)).limit(1))[0]!;
      await writeAudit(transaction, {
        module: 'branches', action: 'update', entityType: 'branch', entityId: id,
        beforeState: before, afterState: after, createdAt: updatedAt,
      });
      return after;
    });
  },
  async deleteUnreferenced(id) {
    try {
      return await database.transaction(async (transaction) => {
        const branch = (await transaction.select().from(branches).where(eq(branches.id, id)).for('update').limit(1))[0];
        if (!branch) return 'not_found' as const;
        if (branch.hasEverBeenReferenced) return 'referenced' as const;
        const result = await transaction.delete(branches).where(and(eq(branches.id, id), eq(branches.hasEverBeenReferenced, false)));
        if (result[0].affectedRows !== 1) return 'referenced' as const;
        const createdAt = now();
        await writeAudit(transaction, {
          module: 'branches', action: 'delete', entityType: 'branch', entityId: id,
          beforeState: branch, createdAt,
        });
        return 'deleted' as const;
      });
    } catch (error) {
      if (isReferencedRowError(error)) return 'referenced';
      throw error;
    }
  },
  async markReferenced(id) {
    return database.transaction(async (transaction) => {
      const before = (await transaction.select().from(branches).where(eq(branches.id, id)).for('update').limit(1))[0];
      if (!before) return false;
      if (before.hasEverBeenReferenced) return true;
      const updatedAt = now();
      const result = await transaction.update(branches).set({ hasEverBeenReferenced: true, updatedAt }).where(eq(branches.id, id));
      if (result[0].affectedRows !== 1) return false;
      await writeAudit(transaction, {
        module: 'branches', action: 'reference_lock', entityType: 'branch', entityId: id,
        beforeState: before, afterState: { ...before, hasEverBeenReferenced: true, updatedAt }, createdAt: updatedAt,
      });
      return true;
    });
  },
});
