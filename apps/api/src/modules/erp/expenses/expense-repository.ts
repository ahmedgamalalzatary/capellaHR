import type { createDatabase } from '@capella/database';
import { accounts, erpCategories, erpExpenses } from '@capella/database/schema';
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';

import { markCategoryReferenced } from '../catalog/index.js';
import type { ErpAuditCapability } from '../hr-capabilities.js';
import type { ExpenseRecord, ExpenseRepository } from './expense-service.js';

type Database = ReturnType<typeof createDatabase>;
const selection = {
  id: erpExpenses.id, branchId: erpExpenses.branchId, categoryId: erpExpenses.categoryId,
  categoryName: erpCategories.name, amount: erpExpenses.amount, expenseDate: erpExpenses.expenseDate,
  description: erpExpenses.description, actingAccountId: erpExpenses.actingAccountId,
  actingUsername: accounts.username, kind: erpExpenses.kind, status: erpExpenses.status,
  reversalOfId: erpExpenses.reversalOfId, supersedesId: erpExpenses.supersedesId,
  correctionReason: erpExpenses.correctionReason, createdAt: erpExpenses.createdAt,
};
const joined = <T extends Pick<Database, 'select'>>(executor: T) => executor.select(selection).from(erpExpenses)
  .innerJoin(erpCategories, eq(erpCategories.id, erpExpenses.categoryId))
  .innerJoin(accounts, eq(accounts.id, erpExpenses.actingAccountId));
const categoryValid = async (tx: Parameters<Parameters<Database['transaction']>[0]>[0], branchId: number, categoryId: number) => (
  (await tx.select({ id: erpCategories.id }).from(erpCategories).where(and(
    eq(erpCategories.id, categoryId), eq(erpCategories.branchId, branchId),
    eq(erpCategories.type, 'expense'), eq(erpCategories.isActive, true),
  )).for('update').limit(1))[0] !== undefined
);

export const createDrizzleExpenseRepository = (database: Database, audit: ErpAuditCapability, now: () => Date = () => new Date()): ExpenseRepository => ({
  async create(input) {
    return database.transaction(async (tx) => {
      if (!await categoryValid(tx, input.branchId, input.categoryId)) return 'invalid-category';
      const at = now();
      const inserted = await tx.insert(erpExpenses).values({ ...input, kind: 'expense', status: 'active', createdAt: at });
      const id = Number(inserted[0].insertId);
      await markCategoryReferenced(tx, input.categoryId, at);
      const record = (await joined(tx).where(eq(erpExpenses.id, id)).limit(1))[0] as ExpenseRecord;
      await audit.record(tx, { module: 'erp-expenses', action: 'create', entityType: 'expense', entityId: id, afterState: record, relatedIds: { branchId: input.branchId, categoryId: input.categoryId, actingAccountId: input.actingAccountId }, createdAt: at });
      return record;
    });
  },
  async findById(id) {
    return (await joined(database).where(eq(erpExpenses.id, id)).limit(1))[0] as ExpenseRecord | undefined ?? null;
  },
  async list(branchId, query) {
    const filters = [eq(erpExpenses.branchId, branchId)];
    if (query.categoryId !== undefined) filters.push(eq(erpExpenses.categoryId, query.categoryId));
    if (query.fromDate !== undefined) filters.push(gte(erpExpenses.expenseDate, query.fromDate));
    if (query.toDate !== undefined) filters.push(lte(erpExpenses.expenseDate, query.toDate));
    if (query.status !== undefined) filters.push(eq(erpExpenses.status, query.status));
    const where = and(...filters);
    const items = await joined(database).where(where).orderBy(desc(erpExpenses.expenseDate), desc(erpExpenses.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize) as ExpenseRecord[];
    const totals = await database.select({ value: count() }).from(erpExpenses).where(where);
    return { items, total: totals[0]?.value ?? 0 };
  },
  async correct(id, input) {
    return database.transaction(async (tx) => {
      const target = (await tx.select({ id: erpExpenses.id, kind: erpExpenses.kind, status: erpExpenses.status }).from(erpExpenses).where(and(eq(erpExpenses.id, id), eq(erpExpenses.branchId, input.branchId))).for('update').limit(1))[0];
      if (!target || target.kind !== 'expense') return 'invalid-target';
      if (target.status !== 'active') return 'already-corrected';
      const original = (await joined(tx).where(and(eq(erpExpenses.id, id), eq(erpExpenses.branchId, input.branchId))).limit(1))[0] as ExpenseRecord;
      if (!await categoryValid(tx, input.branchId, input.categoryId)) return 'invalid-category';
      const at = now();
      const reversalInsert = await tx.insert(erpExpenses).values({
        branchId: input.branchId, categoryId: original.categoryId, amount: original.amount,
        expenseDate: original.expenseDate, description: original.description, actingAccountId: input.actingAccountId,
        kind: 'reversal', status: 'active', reversalOfId: id, correctionReason: input.reason, createdAt: at,
      });
      const reversalId = Number(reversalInsert[0].insertId);
      const replacementInsert = await tx.insert(erpExpenses).values({
        branchId: input.branchId, categoryId: input.categoryId, amount: input.amount,
        expenseDate: input.expenseDate, description: input.description, actingAccountId: input.actingAccountId,
        kind: 'expense', status: 'active', createdAt: at,
      });
      const replacementId = Number(replacementInsert[0].insertId);
      await tx.update(erpExpenses).set({ supersedesId: id, correctionReason: input.reason }).where(eq(erpExpenses.id, replacementId));
      await tx.update(erpExpenses).set({ status: 'corrected' }).where(eq(erpExpenses.id, id));
      await markCategoryReferenced(tx, input.categoryId, at);
      const [reversal, replacement] = await Promise.all([
        joined(tx).where(eq(erpExpenses.id, reversalId)).limit(1).then((rows) => rows[0] as ExpenseRecord),
        joined(tx).where(eq(erpExpenses.id, replacementId)).limit(1).then((rows) => rows[0] as ExpenseRecord),
      ]);
      const corrected = { ...original, status: 'corrected' as const };
      await audit.record(tx, { module: 'erp-expenses', action: 'correct', entityType: 'expense', entityId: id, beforeState: original, afterState: corrected, relatedIds: { branchId: input.branchId, actingAccountId: input.actingAccountId, reversalId, replacementId }, createdAt: at });
      await audit.record(tx, { module: 'erp-expenses', action: 'create-reversal', entityType: 'expense', entityId: reversalId, afterState: reversal, relatedIds: { branchId: input.branchId, actingAccountId: input.actingAccountId, originalId: id }, createdAt: at });
      await audit.record(tx, { module: 'erp-expenses', action: 'create-correction', entityType: 'expense', entityId: replacementId, afterState: replacement, relatedIds: { branchId: input.branchId, actingAccountId: input.actingAccountId, originalId: id }, createdAt: at });
      return { original: corrected, reversal, replacement };
    });
  },
});
