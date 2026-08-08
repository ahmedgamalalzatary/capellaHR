import { createDatabase } from '@capella/database';
import { accounts, auditEvents, branches, erpCategories, erpExpenses } from '@capella/database/schema';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuditModule } from '../../src/modules/audit/index.js';
import { createBranchesModule } from '../../src/modules/branches/index.js';
import { createDrizzleExpenseRepository, createErpExpensesModule, type ErpAccountIdentity } from '../../src/modules/erp/index.js';

const control = createDatabase(process.env.DATABASE_URL ?? '');
const databaseName = `capella_hr-test-erp15-${process.pid}-${Date.now()}`;
const url = new URL(process.env.DATABASE_URL ?? '');
url.pathname = `/${databaseName}`;
const database = createDatabase(url.toString());
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
    const category = await tx.insert(erpCategories).values({ branchId, type: 'expense', name: 'تشغيل', nameNormalized: `expense-category-${suffix}`, createdAt: at, updatedAt: at });
    return { branchId, categoryId: Number(category[0].insertId) };
  });
};
beforeAll(async () => {
  if (!/^capella_hr-test-erp15-\d+-\d+$/.test(databaseName)) throw new Error('Unsafe ERP 15 database name');
  await control.execute(sql.raw(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`));
  await migrate(database, { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/database/migrations') });
  const accountId = Number((await database.insert(accounts).values({ username: `expense-admin-${process.pid}`, passwordHash: 'test-only', role: 'admin', createdAt: new Date(), updatedAt: new Date() }))[0].insertId);
  ADMIN = { role: 'admin', accountId };
}, 120_000);
beforeEach(async () => { await database.delete(auditEvents).where(eq(auditEvents.module, 'erp-expenses')); });
afterAll(async () => {
  await database.$client.promise().end();
  await control.execute(sql.raw(`DROP DATABASE IF EXISTS \`${databaseName}\``));
  await control.$client.promise().end();
}, 30_000);

describe('MySQL-backed ERP expenses', () => {
  it('creates, filters and atomically appends correction lineage with audits', async () => {
    const { branchId, categoryId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, categoryId, amount: '125.50', expenseDate: '2026-08-05', description: 'مستلزمات' });
    const corrected = await expenses.service.correct(ADMIN, original.id, { branchId, categoryId, amount: '100.00', expenseDate: '2026-08-05', description: 'القيمة الصحيحة', reason: 'قيمة خاطئة' });
    expect(corrected).toMatchObject({ original: { status: 'corrected' }, reversal: { kind: 'reversal', reversalOfId: original.id }, replacement: { kind: 'expense', supersedesId: original.id } });
    expect((await expenses.service.list(ADMIN, { branchId, categoryId, fromDate: '2026-08-01', toDate: '2026-08-31', page: 1, pageSize: 20 })).total).toBe(3);
    await expect(expenses.service.correct(ADMIN, original.id, { branchId, categoryId, amount: '90.00', expenseDate: '2026-08-05', description: 'x', reason: 'x' })).rejects.toMatchObject({ code: 'EXPENSE_ALREADY_CORRECTED' });
    const chained = await expenses.service.correct(ADMIN, corrected.replacement.id, { branchId, categoryId, amount: '95.00', expenseDate: '2026-08-05', description: 'تصحيح ثانٍ', reason: 'التصحيح الأول خاطئ' });
    expect(chained).toMatchObject({ reversal: { reversalOfId: corrected.replacement.id }, replacement: { supersedesId: corrected.replacement.id } });
    const events = await database.select().from(auditEvents).where(eq(auditEvents.module, 'erp-expenses'));
    expect(events.map((event) => event.action).sort()).toEqual(['correct', 'correct', 'create', 'create-correction', 'create-correction', 'create-reversal', 'create-reversal']);
  });

  it('rejects a service category without leaving an expense or audit event', async () => {
    const { branchId } = await seed(); const at = new Date();
    const category = await database.insert(erpCategories).values({ branchId, type: 'service', name: 'خدمات', nameNormalized: `service-${process.pid}-${++sequence}`, createdAt: at, updatedAt: at });
    await expect(expenses.service.create(ADMIN, { branchId, categoryId: Number(category[0].insertId), amount: '10.00', expenseDate: '2026-08-05', description: 'x' })).rejects.toMatchObject({ code: 'EXPENSE_CATEGORY_INVALID' });
    expect((await database.select().from(erpExpenses).where(eq(erpExpenses.branchId, branchId))).length).toBe(0);
    expect((await database.select().from(auditEvents).where(eq(auditEvents.module, 'erp-expenses'))).length).toBe(0);
  });

  it('rolls back the expense and category reference when audit persistence fails', async () => {
    const { branchId, categoryId } = await seed();
    const repository = createDrizzleExpenseRepository(database, { record: async () => { throw new Error('audit unavailable'); } });
    await expect(repository.create({ branchId, categoryId, actingAccountId: ADMIN.accountId, amount: '10.00', expenseDate: '2026-08-05', description: 'x' })).rejects.toThrow('audit unavailable');
    expect((await database.select().from(erpExpenses).where(eq(erpExpenses.branchId, branchId))).length).toBe(0);
    expect((await database.select().from(erpCategories).where(eq(erpCategories.id, categoryId)).limit(1))[0]?.hasEverBeenReferenced).toBe(false);
  });

  it('rolls back all correction facts and status when an audit write fails', async () => {
    const { branchId, categoryId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, categoryId, amount: '10.00', expenseDate: '2026-08-05', description: 'original' });
    let auditWrites = 0;
    const repository = createDrizzleExpenseRepository(database, {
      record: async () => { auditWrites += 1; if (auditWrites === 2) throw new Error('audit unavailable'); },
    });

    await expect(repository.correct(original.id, { branchId, categoryId, actingAccountId: ADMIN.accountId, amount: '11.00', expenseDate: '2026-08-05', description: 'replacement', reason: 'fix' })).rejects.toThrow('audit unavailable');
    expect(await expenses.service.get(ADMIN, original.id, branchId)).toMatchObject({ status: 'active', amount: '10.00' });
    expect((await database.select().from(erpExpenses).where(eq(erpExpenses.branchId, branchId))).length).toBe(1);
  });

  it('serializes concurrent corrections so exactly one lineage is committed', async () => {
    const { branchId, categoryId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, categoryId, amount: '10.00', expenseDate: '2026-08-05', description: 'original' });
    const input = { branchId, categoryId, amount: '11.00', expenseDate: '2026-08-05', description: 'replacement', reason: 'fix' };
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
    const { branchId, categoryId } = await seed();
    const created = await expenses.service.create(ADMIN, { branchId, categoryId, amount: '10.00', expenseDate: '2026-08-05', description: 'immutable' });
    await expect(database.update(erpExpenses).set({ amount: '11.00' }).where(eq(erpExpenses.id, created.id))).rejects.toThrow();
    await expect(database.delete(erpExpenses).where(eq(erpExpenses.id, created.id))).rejects.toThrow();
    expect(await expenses.service.get(ADMIN, created.id, branchId)).toMatchObject({ amount: '10.00', description: 'immutable', status: 'active' });
  });

  it('rejects direct status transitions without a complete expense correction lineage', async () => {
    const { branchId, categoryId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, categoryId, amount: '10.00', expenseDate: '2026-08-05', description: 'original' });
    await expect(database.update(erpExpenses).set({ status: 'corrected' }).where(eq(erpExpenses.id, original.id))).rejects.toThrow();
    const corrected = await expenses.service.correct(ADMIN, original.id, { branchId, categoryId, amount: '11.00', expenseDate: '2026-08-05', description: 'replacement', reason: 'fix' });
    await expect(database.update(erpExpenses).set({ status: 'corrected' }).where(eq(erpExpenses.id, corrected.reversal.id))).rejects.toThrow();
  });

  it('rejects correction state and lineage on direct insert', async () => {
    const { branchId, categoryId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, categoryId, amount: '10.00', expenseDate: '2026-08-05', description: 'original' });
    const facts = { branchId, categoryId, amount: '11.00', expenseDate: '2026-08-05', description: 'forged', actingAccountId: ADMIN.accountId, createdAt: new Date() };

    await expect(database.insert(erpExpenses).values({ ...facts, status: 'corrected' })).rejects.toThrow();
    await expect(database.insert(erpExpenses).values({ ...facts, supersedesId: original.id, correctionReason: 'forged' })).rejects.toThrow();
  });

  it('rejects making an expense supersede itself', async () => {
    const { branchId, categoryId } = await seed();
    const original = await expenses.service.create(ADMIN, { branchId, categoryId, amount: '10.00', expenseDate: '2026-08-05', description: 'original' });
    await database.insert(erpExpenses).values({
      branchId, categoryId, amount: original.amount, expenseDate: original.expenseDate,
      description: original.description, actingAccountId: ADMIN.accountId, kind: 'reversal',
      reversalOfId: original.id, correctionReason: 'forged', createdAt: new Date(),
    });

    await expect(database.update(erpExpenses).set({ supersedesId: original.id, correctionReason: 'forged' }).where(eq(erpExpenses.id, original.id))).rejects.toThrow();
  });
});
