import { type createDatabase } from '@capella/database';
import { branches } from '@capella/database/schema';
import { and, asc, count, eq, or, sql } from 'drizzle-orm';

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
    const createdAt = now();
    const result = await database.insert(branches).values({ ...input, createdAt, updatedAt: createdAt });
    return (await this.findById(Number(result[0].insertId)))!;
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
    await database.update(branches).set({ ...input, updatedAt: now() }).where(eq(branches.id, id));
    return this.findById(id);
  },
  async deleteUnreferenced(id) {
    const branch = await this.findById(id);
    if (!branch) return 'not_found';
    if (branch.hasEverBeenReferenced) return 'referenced';
    let result;
    try {
      result = await database.delete(branches).where(and(eq(branches.id, id), eq(branches.hasEverBeenReferenced, false)));
    } catch (error) {
      if (isReferencedRowError(error)) return 'referenced';
      throw error;
    }
    return result[0].affectedRows === 1 ? 'deleted' : 'referenced';
  },
  async markReferenced(id) {
    const result = await database.update(branches).set({ hasEverBeenReferenced: true, updatedAt: now() }).where(eq(branches.id, id));
    return result[0].affectedRows === 1;
  },
});
