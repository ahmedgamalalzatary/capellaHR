import { accounts, auditEvents, branches, erpExpenses } from '@capella/database/schema';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuditModule } from '../../src/modules/audit/index.js';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createDrizzleExpenseRepository, createErpExpensesModule, type ErpAccountIdentity } from '../../src/modules/erp/index.js';
import { closeMysqlIntegrationDatabase, createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();
const expenses = createErpExpensesModule(database, {
  audit: createAuditModule(database).erp,
  branches: createBranchesModule(database).erp,
  employees: { findActiveById: async () => null },
});
let ADMIN: ErpAccountIdentity = { role: 'admin', accountId: 0 };
let sequence = 0;
const seed = async () => {
  const at = new Date(); const suffix = `${process.pid}-${++sequence}`;
  return database.transaction(async (tx) => {
    const branch = await tx.insert(branches).values({ name: `Expense ${suffix}`, nameNormalized: `expense-${suffix}`, location: 'Cairo', latitude: 30, longitude: 31, gpsAccuracyMeters: 5, attendanceRadiusMeters: 50, createdAt: at, updatedAt: at });
    const branchId = Number(branch[0].insertId);
    return { branchId };
  });
};
beforeAll(async () => {
  await prepareMysqlIntegrationDatabase(database);
  const accountId = Number((await database.insert(accounts).values({ username: `expense-admin-${process.pid}`, passwordHash: 'test-only', role: 'admin', createdAt: new Date(), updatedAt: new Date() }))[0].insertId);
  ADMIN = { role: 'admin', accountId };
}, 120_000);
beforeEach(async () => { await database.delete(auditEvents).where(eq(auditEvents.module, 'erp-expenses')); });
afterAll(async () => {
  await closeMysqlIntegrationDatabase(database);
}, 30_000);

describe('MySQL-backed ERP expenses', () => {
  it('creates, filters and atomically appends correction lineage with audits', async () => {
    const { branchId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, name: 'كهرباء', amount: '125.50', expenseDate: '2026-08-05', description: 'مستلزمات' });
    const corrected = await expenses.service.correct(ADMIN, original.id, { branchId, name: 'كهرباء', amount: '100.00', expenseDate: '2026-08-05', description: 'القيمة الصحيحة', reason: 'قيمة خاطئة' });
    expect(corrected).toMatchObject({ original: { status: 'corrected' }, reversal: { kind: 'reversal', reversalOfId: original.id }, replacement: { kind: 'expense', supersedesId: original.id } });
    expect((await expenses.service.list(ADMIN, { branchId, search: 'كهرباء', fromDate: '2026-08-01', toDate: '2026-08-31', page: 1, pageSize: 20 })).total).toBe(3);
    expect((await expenses.service.list(ADMIN, { branchId, search: 'مياه', page: 1, pageSize: 20 })).total).toBe(0);
    await expect(expenses.service.correct(ADMIN, original.id, { branchId, name: 'كهرباء', amount: '90.00', expenseDate: '2026-08-05', description: 'x', reason: 'x' })).rejects.toMatchObject({ code: 'EXPENSE_ALREADY_CORRECTED' });
    const chained = await expenses.service.correct(ADMIN, corrected.replacement.id, { branchId, name: 'كهرباء', amount: '95.00', expenseDate: '2026-08-05', description: 'تصحيح ثانٍ', reason: 'التصحيح الأول خاطئ' });
    expect(chained).toMatchObject({ reversal: { reversalOfId: corrected.replacement.id }, replacement: { supersedesId: corrected.replacement.id } });
    const events = await database.select().from(auditEvents).where(eq(auditEvents.module, 'erp-expenses'));
    expect(events.map((event) => event.action).sort()).toEqual(['correct', 'correct', 'create', 'create-correction', 'create-correction', 'create-reversal', 'create-reversal']);
  });

  it('records an expense by its own name, with optional notes', async () => {
    const { branchId } = await seed();
    const named = await expenses.service.create(ADMIN, {
      branchId, name: 'فاتورة كهرباء', amount: '75.00', expenseDate: '2026-08-05',
    });

    expect(named).toMatchObject({ name: 'فاتورة كهرباء', description: '' });
    expect(await expenses.service.get(ADMIN, named.id, branchId))
      .toMatchObject({ name: 'فاتورة كهرباء' });
  });

  it('rolls back the expense when audit persistence fails', async () => {
    const { branchId } = await seed();
    const repository = createDrizzleExpenseRepository(database, { record: async () => { throw new Error('audit unavailable'); } });
    await expect(repository.create({ branchId, name: 'كهرباء', actingAccountId: ADMIN.accountId, amount: '10.00', expenseDate: '2026-08-05', description: 'x' })).rejects.toThrow('audit unavailable');
    expect((await database.select().from(erpExpenses).where(eq(erpExpenses.branchId, branchId))).length).toBe(0);
  });

  it('rolls back all correction facts and status when an audit write fails', async () => {
    const { branchId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, name: 'كهرباء', amount: '10.00', expenseDate: '2026-08-05', description: 'original' });
    let auditWrites = 0;
    const repository = createDrizzleExpenseRepository(database, {
      record: async () => { auditWrites += 1; if (auditWrites === 2) throw new Error('audit unavailable'); },
    });

    await expect(repository.correct(original.id, { branchId, name: 'كهرباء', actingAccountId: ADMIN.accountId, amount: '11.00', expenseDate: '2026-08-05', description: 'replacement', reason: 'fix' })).rejects.toThrow('audit unavailable');
    expect(await expenses.service.get(ADMIN, original.id, branchId)).toMatchObject({ status: 'active', amount: '10.00' });
    expect((await database.select().from(erpExpenses).where(eq(erpExpenses.branchId, branchId))).length).toBe(1);
  });

  it('serializes concurrent corrections so exactly one lineage is committed', async () => {
    const { branchId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, name: 'كهرباء', amount: '10.00', expenseDate: '2026-08-05', description: 'original' });
    const input = { branchId, name: 'كهرباء', amount: '11.00', expenseDate: '2026-08-05', description: 'replacement', reason: 'fix' };
    const attempts = await Promise.allSettled([
      expenses.service.correct(ADMIN, original.id, input),
      expenses.service.correct(ADMIN, original.id, input),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'EXPENSE_ALREADY_CORRECTED' } });
    expect((await database.select().from(erpExpenses).where(eq(erpExpenses.branchId, branchId))).length).toBe(3);
  });

  it('rejects direct fact edits and destructive deletion at the database boundary', async () => {
    const { branchId } = await seed();
    const created = await expenses.service.create(ADMIN, { branchId, name: 'كهرباء', amount: '10.00', expenseDate: '2026-08-05', description: 'immutable' });
    await expect(database.update(erpExpenses).set({ amount: '11.00' }).where(eq(erpExpenses.id, created.id))).rejects.toThrow();
    await expect(database.delete(erpExpenses).where(eq(erpExpenses.id, created.id))).rejects.toThrow();
    expect(await expenses.service.get(ADMIN, created.id, branchId)).toMatchObject({ amount: '10.00', description: 'immutable', status: 'active' });
  });

  it('rejects direct status transitions without a complete expense correction lineage', async () => {
    const { branchId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, name: 'كهرباء', amount: '10.00', expenseDate: '2026-08-05', description: 'original' });
    await expect(database.update(erpExpenses).set({ status: 'corrected' }).where(eq(erpExpenses.id, original.id))).rejects.toThrow();
    const corrected = await expenses.service.correct(ADMIN, original.id, { branchId, name: 'كهرباء', amount: '11.00', expenseDate: '2026-08-05', description: 'replacement', reason: 'fix' });
    await expect(database.update(erpExpenses).set({ status: 'corrected' }).where(eq(erpExpenses.id, corrected.reversal.id))).rejects.toThrow();
  });

  it('rejects correction state and lineage on direct insert', async () => {
    const { branchId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, name: 'كهرباء', amount: '10.00', expenseDate: '2026-08-05', description: 'original' });
    const facts = { branchId, name: 'كهرباء', amount: '11.00', expenseDate: '2026-08-05', description: 'forged', actingAccountId: ADMIN.accountId, createdAt: new Date() };

    await expect(database.insert(erpExpenses).values({ ...facts, status: 'corrected' })).rejects.toThrow();
    await expect(database.insert(erpExpenses).values({
      ...facts,
      supersedesId: original.id,
      correctionOperationId: randomUUID(),
      correctionReason: 'forged',
    })).rejects.toThrow();
  });

  it('rejects making an expense supersede itself', async () => {
    const { branchId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, name: 'كهرباء', amount: '10.00', expenseDate: '2026-08-05', description: 'original' });
    await expect(database.update(erpExpenses).set({ supersedesId: original.id, correctionReason: 'forged' }).where(eq(erpExpenses.id, original.id))).rejects.toThrow();
  });

  it('rejects linking a replacement after a reversal committed separately', async () => {
    const { branchId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, name: 'كهرباء', amount: '10.00', expenseDate: '2026-08-05', description: 'original' });
    const reversalOperationId = randomUUID();
    await database.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO erp_expense_correction_guards
        (connection_id, operation_id, original_id)
        VALUES (CONNECTION_ID(), ${reversalOperationId}, ${original.id})`);
      await tx.insert(erpExpenses).values({
        branchId, name: original.name, amount: original.amount, expenseDate: original.expenseDate,
        description: original.description, actingAccountId: ADMIN.accountId, kind: 'reversal',
        reversalOfId: original.id, correctionOperationId: reversalOperationId,
        correctionReason: 'separate reversal', createdAt: new Date(),
      });
      await tx.execute(sql`DELETE FROM erp_expense_correction_guards
        WHERE connection_id = CONNECTION_ID()`);
    });
    await expect(database.transaction(async (tx) => tx.insert(erpExpenses).values({
      branchId, name: 'كهرباء', amount: '11.00', expenseDate: '2026-08-05',
      description: 'unrelated replacement', actingAccountId: ADMIN.accountId,
      supersedesId: original.id, correctionOperationId: reversalOperationId,
      correctionReason: 'post-hoc link', createdAt: new Date(),
    }))).rejects.toThrow();
  });

  it('rejects invoking the protected correction operation outside a transaction', async () => {
    const { branchId } = await seed();
    const original = await expenses.service.create(ADMIN, {
      branchId, name: 'كهرباء', amount: '10.00', expenseDate: '2026-08-05', description: 'original',
    });

    await expect(database.execute(sql`CALL correct_erp_expense(
      ${original.id}, ${branchId}, ${'كهرباء'}, ${'11.00'}, ${'2026-08-05'},
      ${'replacement'}, ${ADMIN.accountId}, ${'fix'}, ${new Date()}, ${randomUUID()}
    )`)).rejects.toThrow();

    expect((await database.select().from(erpExpenses).where(eq(erpExpenses.branchId, branchId))))
      .toHaveLength(1);
  });
});
