import { type createDatabase } from '@capella/database';
import { erpCategories, erpServiceCommissionOverrides, erpServices } from '@capella/database/schema';
import { and, asc, count, eq, sql } from 'drizzle-orm';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import { CATALOG_AUDIT_MODULE, markCategoryReferenced } from './categories-repository.js';
import type {
  CommissionOverrideRecord,
  ServiceRecord,
  ServiceRepository,
} from './services-service.js';

type Database = ReturnType<typeof createDatabase>;
type ServiceRow = typeof erpServices.$inferSelect;

/** `nameNormalized` is an internal duplicate-detection detail, not an API fact. */
const toRecord = (row: ServiceRow): ServiceRecord => ({
  id: row.id,
  branchId: row.branchId,
  categoryId: row.categoryId,
  name: row.name,
  description: row.description,
  price: row.price,
  commissionPercent: row.commissionPercent,
  isActive: row.isActive,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createDrizzleServiceRepository = (
  database: Database,
  audit: ErpAuditCapability,
  now: () => Date = () => new Date(),
): ServiceRepository => ({
  async create(input) {
    return database.transaction(async (transaction) => {
      const createdAt = now();
      // Locking the category first fixes one lock order for every module that
      // will mark a category referenced.
      await markCategoryReferenced(transaction, input.categoryId, createdAt);
      const result = await transaction.insert(erpServices)
        .values({ ...input, createdAt, updatedAt: createdAt });
      const id = Number(result[0].insertId);
      const record = toRecord((await transaction.select().from(erpServices)
        .where(eq(erpServices.id, id)).limit(1))[0]!);
      await audit.record(transaction, {
        module: CATALOG_AUDIT_MODULE,
        action: 'create',
        entityType: 'service',
        entityId: id,
        afterState: record,
        relatedIds: { branchId: record.branchId, categoryId: record.categoryId },
        createdAt,
      });
      return record;
    });
  },

  async findById(id) {
    const row = (await database.select().from(erpServices)
      .where(eq(erpServices.id, id)).limit(1))[0];
    return row ? toRecord(row) : null;
  },

  async findByNormalizedName(branchId, nameNormalized) {
    const row = (await database.select().from(erpServices).where(and(
      eq(erpServices.branchId, branchId),
      eq(erpServices.nameNormalized, nameNormalized),
    )).limit(1))[0];
    return row ? toRecord(row) : null;
  },

  async list(branchId, query) {
    const filters = [eq(erpServices.branchId, branchId)];
    if (query.categoryId !== undefined) filters.push(eq(erpServices.categoryId, query.categoryId));
    if (query.isActive === true) {
      // "Sellable" means both the service and the category it sits under are
      // live, so retiring a whole category removes its services from the counter.
      filters.push(eq(erpServices.isActive, true), eq(erpCategories.isActive, true));
    } else if (query.isActive === false) {
      filters.push(sql`(${erpServices.isActive} = false or ${erpCategories.isActive} = false)`);
    }
    // Search text is matched literally with locate(), never interpolated into a
    // LIKE pattern, so `%` and `_` typed at the counter stay ordinary characters.
    if (query.search) filters.push(sql`locate(${query.search}, ${erpServices.name}) > 0`);
    const where = and(...filters);

    const rows = await database.select({
      service: erpServices,
      categoryName: erpCategories.name,
      categoryIsActive: erpCategories.isActive,
    }).from(erpServices)
      .innerJoin(erpCategories, eq(erpServices.categoryId, erpCategories.id))
      .where(where)
      .orderBy(asc(erpServices.name), asc(erpServices.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() }).from(erpServices)
      .innerJoin(erpCategories, eq(erpServices.categoryId, erpCategories.id))
      .where(where);

    return {
      items: rows.map((row) => ({
        ...toRecord(row.service),
        categoryName: row.categoryName,
        categoryIsActive: row.categoryIsActive,
      })),
      total: totals[0]?.value ?? 0,
    };
  },

  async update(id, branchId, changes) {
    return database.transaction(async (transaction) => {
      const scope = and(eq(erpServices.id, id), eq(erpServices.branchId, branchId));
      const before = (await transaction.select().from(erpServices)
        .where(scope).for('update').limit(1))[0];
      if (!before) return null;
      if (Object.keys(changes).length === 0) return toRecord(before);

      const updatedAt = now();
      if (changes.categoryId !== undefined && changes.categoryId !== before.categoryId) {
        await markCategoryReferenced(transaction, changes.categoryId, updatedAt);
      }
      await transaction.update(erpServices).set({ ...changes, updatedAt }).where(scope);
      const after = toRecord((await transaction.select().from(erpServices)
        .where(scope).limit(1))[0]!);
      await audit.record(transaction, {
        module: CATALOG_AUDIT_MODULE,
        action: 'update',
        entityType: 'service',
        entityId: id,
        beforeState: toRecord(before),
        afterState: after,
        relatedIds: { branchId, categoryId: after.categoryId },
        createdAt: updatedAt,
      });
      return after;
    });
  },

  async listOverrides(serviceId) {
    return database.select().from(erpServiceCommissionOverrides)
      .where(eq(erpServiceCommissionOverrides.serviceId, serviceId))
      .orderBy(asc(erpServiceCommissionOverrides.employeeId));
  },

  async setOverride(serviceId, employeeId, commissionPercent) {
    return database.transaction(async (transaction) => {
      const scope = and(
        eq(erpServiceCommissionOverrides.serviceId, serviceId),
        eq(erpServiceCommissionOverrides.employeeId, employeeId),
      );
      const at = now();
      const before = (await transaction.select().from(erpServiceCommissionOverrides)
        .where(scope).for('update').limit(1))[0];

      if (before) {
        await transaction.update(erpServiceCommissionOverrides)
          .set({ commissionPercent, updatedAt: at }).where(scope);
      } else {
        await transaction.insert(erpServiceCommissionOverrides)
          .values({ serviceId, employeeId, commissionPercent, createdAt: at, updatedAt: at });
      }
      const after = (await transaction.select().from(erpServiceCommissionOverrides)
        .where(scope).limit(1))[0]!;
      await audit.record(transaction, {
        module: CATALOG_AUDIT_MODULE,
        action: before ? 'update' : 'create',
        entityType: 'service-commission-override',
        entityId: after.id,
        ...(before ? { beforeState: before } : {}),
        afterState: after,
        relatedIds: { serviceId, employeeId },
        createdAt: at,
      });
      return after satisfies CommissionOverrideRecord;
    });
  },

  async deleteOverride(serviceId, employeeId) {
    return database.transaction(async (transaction) => {
      const scope = and(
        eq(erpServiceCommissionOverrides.serviceId, serviceId),
        eq(erpServiceCommissionOverrides.employeeId, employeeId),
      );
      const before = (await transaction.select().from(erpServiceCommissionOverrides)
        .where(scope).for('update').limit(1))[0];
      if (!before) return false;

      const at = now();
      await transaction.delete(erpServiceCommissionOverrides).where(scope);
      await audit.record(transaction, {
        module: CATALOG_AUDIT_MODULE,
        action: 'delete',
        entityType: 'service-commission-override',
        entityId: before.id,
        beforeState: before,
        relatedIds: { serviceId, employeeId },
        createdAt: at,
      });
      return true;
    });
  },
});
