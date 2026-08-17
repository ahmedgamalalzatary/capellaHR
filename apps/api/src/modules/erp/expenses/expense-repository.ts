import type { createDatabase } from '@capella/database';
import { accounts, erpExpenses } from '@capella/database/schema';
import { and, count, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import type { ExpenseRecord, ExpenseRepository } from './expense-service.js';

type Database = ReturnType<typeof createDatabase>;
const selection = {
  id: erpExpenses.id, branchId: erpExpenses.branchId, name: erpExpenses.name,
  amount: erpExpenses.amount, expenseDate: erpExpenses.expenseDate,
  description: erpExpenses.description, actingAccountId: erpExpenses.actingAccountId,
  actingUsername: accounts.username, kind: erpExpenses.kind, status: erpExpenses.status,
  reversalOfId: erpExpenses.reversalOfId, supersedesId: erpExpenses.supersedesId,
  correctionReason: erpExpenses.correctionReason, createdAt: erpExpenses.createdAt,
};
const joined = <T extends Pick<Database, 'select'>>(executor: T) => executor.select(selection).from(erpExpenses)
  .innerJoin(accounts, eq(accounts.id, erpExpenses.actingAccountId));
/** An expense is found by its own wording: its name or its notes. */
const escapeLike = (value: string) => value
  .replaceAll('\\', '\\\\')
  .replaceAll('%', '\\%')
  .replaceAll('_', '\\_');

export const createDrizzleExpenseRepository = (database: Database, audit: ErpAuditCapability, now: () => Date = () => new Date()): ExpenseRepository => ({
  async create(input) {
    return database.transaction(async (tx) => {
      const at = now();
      const inserted = await tx.insert(erpExpenses).values({ ...input, description: input.description ?? '', kind: 'expense', status: 'active', createdAt: at });
      const id = Number(inserted[0].insertId);
      const record = (await joined(tx).where(eq(erpExpenses.id, id)).limit(1))[0] as ExpenseRecord;
      await audit.record(tx, { module: 'erp-expenses', action: 'create', entityType: 'expense', entityId: id, afterState: record, relatedIds: { branchId: input.branchId, actingAccountId: input.actingAccountId }, createdAt: at });
      return record;
    });
  },
  async findById(id) {
    return (await joined(database).where(eq(erpExpenses.id, id)).limit(1))[0] as ExpenseRecord | undefined ?? null;
  },
  async list(branchId, query) {
    const filters = [eq(erpExpenses.branchId, branchId)];
    if (query.search !== undefined) {
      const pattern = `%${escapeLike(query.search)}%`;
      filters.push(or(like(erpExpenses.name, pattern), like(erpExpenses.description, pattern))!);
    }
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
      const at = now();
      const correctionOperationId = randomUUID();
      await tx.execute(sql`CALL correct_erp_expense(
        ${id}, ${input.branchId}, ${input.name}, ${input.amount}, ${input.expenseDate},
        ${input.description ?? ''}, ${input.actingAccountId}, ${input.reason}, ${at}, ${correctionOperationId}
      )`);
      const correctionRows = await tx.select({
        id: erpExpenses.id,
        reversalOfId: erpExpenses.reversalOfId,
        supersedesId: erpExpenses.supersedesId,
      }).from(erpExpenses).where(eq(erpExpenses.correctionOperationId, correctionOperationId));
      const reversalId = correctionRows.find((row) => row.reversalOfId === id)?.id;
      const replacementId = correctionRows.find((row) => row.supersedesId === id)?.id;
      if (reversalId === undefined || replacementId === undefined) {
        throw new Error('ERP expense correction procedure did not create complete lineage');
      }
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
