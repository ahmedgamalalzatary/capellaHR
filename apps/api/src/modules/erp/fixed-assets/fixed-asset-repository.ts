import type { createDatabase } from '@capella/database';
import { accounts, erpFixedAssets } from '@capella/database/schema';
import { and, count, desc, eq, like, or } from 'drizzle-orm';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import type { FixedAssetRecord, FixedAssetRepository, FixedAssetWrite } from './fixed-asset-service.js';

type Database = ReturnType<typeof createDatabase>;
const selection = {
  id: erpFixedAssets.id, branchId: erpFixedAssets.branchId, name: erpFixedAssets.name,
  quantity: erpFixedAssets.quantity, unitPrice: erpFixedAssets.unitPrice,
  location: erpFixedAssets.location, note: erpFixedAssets.note,
  purchasedOn: erpFixedAssets.purchasedOn, condition: erpFixedAssets.condition,
  actingAccountId: erpFixedAssets.actingAccountId, actingUsername: accounts.username,
  createdAt: erpFixedAssets.createdAt, updatedAt: erpFixedAssets.updatedAt,
};
const joined = <T extends Pick<Database, 'select'>>(executor: T) => executor.select(selection).from(erpFixedAssets)
  .innerJoin(accounts, eq(accounts.id, erpFixedAssets.actingAccountId));
/** A line is found by the wording the admin wrote: its name, where it is, or the note. */
const escapeLike = (value: string) => value
  .replaceAll('\\', '\\\\')
  .replaceAll('%', '\\%')
  .replaceAll('_', '\\_');
/**
 * An absent optional field means "not written down", which is a real answer here
 * and is stored as NULL rather than as a zero the admin never typed.
 */
const columns = (input: FixedAssetWrite) => ({
  branchId: input.branchId,
  name: input.name,
  quantity: input.quantity ?? null,
  unitPrice: input.unitPrice ?? null,
  location: input.location ?? '',
  note: input.note ?? '',
  purchasedOn: input.purchasedOn ?? null,
  condition: input.condition ?? null,
  actingAccountId: input.actingAccountId,
});

/**
 * Two admins may have the same line open. Taking the row's lock before reading it
 * means the second edit or delete waits, then sees the line as the first one left
 * it — rather than both acting on a line only one of them still has.
 */
const lockLine = async (tx: Parameters<Parameters<Database['transaction']>[0]>[0], where: ReturnType<typeof and>) =>
  (await tx.select({ id: erpFixedAssets.id }).from(erpFixedAssets).where(where).limit(1).for('update')).length > 0;

export const createDrizzleFixedAssetRepository = (
  database: Database,
  audit: ErpAuditCapability,
  now: () => Date = () => new Date(),
): FixedAssetRepository => ({
  async create(input) {
    return database.transaction(async (tx) => {
      const at = now();
      const inserted = await tx.insert(erpFixedAssets).values({ ...columns(input), createdAt: at, updatedAt: at });
      const id = Number(inserted[0].insertId);
      const record = (await joined(tx).where(eq(erpFixedAssets.id, id)).limit(1))[0] as FixedAssetRecord;
      await audit.record(tx, { module: 'erp-fixed-assets', action: 'create', entityType: 'fixed-asset', entityId: id, afterState: record, relatedIds: { branchId: input.branchId, actingAccountId: input.actingAccountId }, createdAt: at });
      return record;
    });
  },
  async findById(id) {
    return (await joined(database).where(eq(erpFixedAssets.id, id)).limit(1))[0] as FixedAssetRecord | undefined ?? null;
  },
  async list(branchId, query) {
    const filters = [eq(erpFixedAssets.branchId, branchId)];
    if (query.search !== undefined) {
      const pattern = `%${escapeLike(query.search)}%`;
      filters.push(or(like(erpFixedAssets.name, pattern), like(erpFixedAssets.location, pattern), like(erpFixedAssets.note, pattern))!);
    }
    const where = and(...filters);
    const items = await joined(database).where(where)
      .orderBy(desc(erpFixedAssets.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize) as FixedAssetRecord[];
    const totals = await database.select({ value: count() }).from(erpFixedAssets).where(where);
    return { items, total: totals[0]?.value ?? 0 };
  },
  async update(id, input) {
    return database.transaction(async (tx) => {
      const scope = and(eq(erpFixedAssets.id, id), eq(erpFixedAssets.branchId, input.branchId));
      if (!await lockLine(tx, scope)) return null;
      const before = (await joined(tx).where(scope).limit(1))[0] as FixedAssetRecord | undefined;
      if (!before) return null;
      const at = now();
      // The lock already proves the line is there, so the affected-row count is not
      // read: MySQL reports none when an edit rewrites a line with what it held.
      await tx.update(erpFixedAssets).set({ ...columns(input), updatedAt: at }).where(scope);
      const record = (await joined(tx).where(scope).limit(1))[0] as FixedAssetRecord;
      await audit.record(tx, { module: 'erp-fixed-assets', action: 'update', entityType: 'fixed-asset', entityId: id, beforeState: before, afterState: record, relatedIds: { branchId: input.branchId, actingAccountId: input.actingAccountId }, createdAt: at });
      return record;
    });
  },
  async remove(id, scope) {
    return database.transaction(async (tx) => {
      const where = and(eq(erpFixedAssets.id, id), eq(erpFixedAssets.branchId, scope.branchId));
      if (!await lockLine(tx, where)) return false;
      const before = (await joined(tx).where(where).limit(1))[0] as FixedAssetRecord | undefined;
      if (!before) return false;
      const at = now();
      const deleted = await tx.delete(erpFixedAssets).where(where);
      // Only the admin who actually removed the line writes its trace.
      if (deleted[0].affectedRows === 0) return false;
      // The row is gone for good, so the audit entry is the only remaining trace of it.
      await audit.record(tx, { module: 'erp-fixed-assets', action: 'delete', entityType: 'fixed-asset', entityId: id, beforeState: before, relatedIds: { branchId: scope.branchId, actingAccountId: scope.actingAccountId }, createdAt: at });
      return true;
    });
  },
});
