import { createDatabase } from '@capella/database';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The one-shot rename of every stored expense can only be trusted by running it:
 * these tests stop the migrations at 0067, write an expense the old way, and let
 * 0068 and 0069 rewrite it.
 */
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/database/migrations',
);
const journal = JSON.parse(readFileSync(
  path.join(migrationsDirectory, 'meta/_journal.json'),
  'utf8',
)) as { entries: Array<{ tag: string }> };

const control = createDatabase(process.env.DATABASE_URL ?? '');
const databaseName = `capella_hr_test_expense_backfill_${process.pid}_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL ?? '');
url.pathname = `/${databaseName}`;
const database = createDatabase(url.toString());

/** Applies the migrations whose tag matches, in journal order. */
const applyMigrations = async (matches: (tag: string) => boolean) => {
  for (const { tag } of journal.entries) {
    if (!matches(tag)) continue;
    const file = readFileSync(path.join(migrationsDirectory, `${tag}.sql`), 'utf8');
    for (const statement of file.split('--> statement-breakpoint')) {
      const trimmed = statement.trim().replace(/;$/, '');
      if (trimmed.length > 0) await database.execute(sql.raw(trimmed));
    }
  }
};

const legacyExpense = async (values: {
  branchId: number;
  categoryId: number;
  accountId: number;
  description: string;
}) => Number((await database.execute(sql`
  INSERT INTO erp_expenses
    (branch_id, category_id, amount, expense_date, description, acting_account_id, created_at)
  VALUES (${values.branchId}, ${values.categoryId}, ${'25.00'}, ${'2026-08-05'},
    ${values.description}, ${values.accountId}, ${new Date()})
`))[0].insertId);

let branchId = 0;
let namedId = 0;
let blankId = 0;

beforeAll(async () => {
  if (!/^capella_hr_test_expense_backfill_\d+_\d+$/.test(databaseName)) {
    throw new Error('Unsafe expense backfill database name');
  }
  await control.execute(sql.raw(
    `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  ));
  // Everything the expenses table needed before it was renamed, and no further.
  await applyMigrations((tag) => Number(tag.slice(0, 4)) <= 67);

  const at = new Date();
  branchId = Number((await database.execute(sql`
    INSERT INTO branches
      (name, name_normalized, location, latitude, longitude, gps_accuracy_meters,
       attendance_radius_meters, created_at, updated_at)
    VALUES (${`Backfill ${process.pid}`}, ${`backfill-${process.pid}`}, 'Cairo', 30, 31, 5, 50,
      ${at}, ${at})
  `))[0].insertId);
  const accountId = Number((await database.execute(sql`
    INSERT INTO accounts (username, password_hash, role, created_at, updated_at)
    VALUES (${`backfill-admin-${process.pid}`}, 'test-only', 'admin', ${at}, ${at})
  `))[0].insertId);
  const categoryId = Number((await database.execute(sql`
    INSERT INTO erp_categories (branch_id, type, name, name_normalized, created_at, updated_at)
    VALUES (${branchId}, 'expense', ${'تشغيل'}, ${`expense-${process.pid}`}, ${at}, ${at})
  `))[0].insertId);

  namedId = await legacyExpense({
    branchId, categoryId, accountId, description: '  فاتورة كهرباء أغسطس  ',
  });
  blankId = await legacyExpense({ branchId, categoryId, accountId, description: ' ' });

  await applyMigrations((tag) => Number(tag.slice(0, 4)) >= 68);
}, 180_000);

afterAll(async () => {
  await database.$client.promise().end();
  await control.execute(sql.raw(`DROP DATABASE IF EXISTS \`${databaseName}\``));
  await control.$client.promise().end();
}, 30_000);

const readExpense = async (id: number) => (await database.execute(sql`
  SELECT name, description FROM erp_expenses WHERE id = ${id}
`))[0] as unknown as Array<{ name: string; description: string }>;

describe('ERP expense name backfill', () => {
  it('names a stored expense after its own wording, leaving the notes untouched', async () => {
    const [row] = await readExpense(namedId);

    expect(row?.name).toBe('فاتورة كهرباء أغسطس');
    // The notes are historical facts: the rename copies them, never edits them.
    expect(row?.description).toBe('  فاتورة كهرباء أغسطس  ');
  });

  it('gives an expense with no wording a name rather than an empty one', async () => {
    const [row] = await readExpense(blankId);

    expect(row?.name).toBe('مصروف');
  });

  it('drops the category and leaves the renamed history immutable', async () => {
    const columns = (await database.execute(sql`
      SELECT column_name AS columnName FROM information_schema.columns
      WHERE table_schema = ${databaseName} AND table_name = 'erp_expenses'
    `))[0] as unknown as Array<{ columnName: string }>;
    expect(columns.map(({ columnName }) => columnName)).not.toContain('category_id');

    // The guard the rename stood down is back on duty.
    await expect(database.execute(sql`
      UPDATE erp_expenses SET name = 'مُحرَّف' WHERE id = ${namedId}
    `)).rejects.toThrow();
  });
});
