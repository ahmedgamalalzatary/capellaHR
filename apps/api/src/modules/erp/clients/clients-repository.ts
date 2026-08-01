import { type createDatabase } from '@capella/database';
import { clients } from '@capella/database/schema';
import { and, asc, count, eq, or, sql } from 'drizzle-orm';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import type { ClientRepository } from './clients-service.js';

type Database = ReturnType<typeof createDatabase>;

const AUDIT_MODULE = 'erp-clients';

export const createDrizzleClientRepository = (
  database: Database,
  audit: ErpAuditCapability,
  now: () => Date = () => new Date(),
): ClientRepository => ({
  async create(input) {
    return database.transaction(async (transaction) => {
      const createdAt = now();
      const result = await transaction.insert(clients).values({ ...input, createdAt, updatedAt: createdAt });
      const id = Number(result[0].insertId);
      const record = (await transaction.select().from(clients).where(eq(clients.id, id)).limit(1))[0]!;
      await audit.record(transaction, {
        module: AUDIT_MODULE,
        action: 'create',
        entityType: 'client',
        entityId: id,
        afterState: record,
        relatedIds: { branchId: record.branchId },
        createdAt,
      });
      return record;
    });
  },

  async findById(id) {
    return (await database.select().from(clients).where(eq(clients.id, id)).limit(1))[0] ?? null;
  },

  async findByPhone(branchId, phone) {
    return (await database.select().from(clients)
      .where(and(eq(clients.branchId, branchId), eq(clients.phone, phone)))
      .limit(1))[0] ?? null;
  },

  async list(branchId, query) {
    // Search text is matched literally with locate(), never interpolated into a
    // LIKE pattern, so `%` and `_` typed at the counter stay ordinary characters.
    const scope = eq(clients.branchId, branchId);
    const where = query.search
      ? and(scope, or(
          sql`locate(${query.search}, ${clients.fullName}) > 0`,
          sql`locate(${query.search}, ${clients.phone}) > 0`,
        ))
      : scope;

    const items = await database.select().from(clients).where(where)
      .orderBy(asc(clients.fullName), asc(clients.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() }).from(clients).where(where);
    return { items, total: totals[0]?.value ?? 0 };
  },

  async update(id, branchId, changes) {
    return database.transaction(async (transaction) => {
      // The branch is part of the lookup, so a client outside the acting branch
      // is invisible to the update rather than merely rejected afterwards.
      const scope = and(eq(clients.id, id), eq(clients.branchId, branchId));
      const before = (await transaction.select().from(clients).where(scope).for('update').limit(1))[0];
      if (!before) return null;
      if (Object.keys(changes).length === 0) return before;

      const updatedAt = now();
      await transaction.update(clients).set({ ...changes, updatedAt }).where(scope);
      const after = (await transaction.select().from(clients).where(scope).limit(1))[0]!;
      await audit.record(transaction, {
        module: AUDIT_MODULE,
        action: 'update',
        entityType: 'client',
        entityId: id,
        beforeState: before,
        afterState: after,
        relatedIds: { branchId },
        createdAt: updatedAt,
      });
      return after;
    });
  },
});
