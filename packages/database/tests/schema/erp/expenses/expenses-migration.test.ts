import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
const name = readdirSync(directory).find((entry) => /^0050_.*\.sql$/.test(entry));
if (!name) throw new Error('ERP 15 migration 0050 is missing');
const migration = readFileSync(`${directory}/${name}`, 'utf8');
const forwardName = readdirSync(directory).find((entry) => /^0053_.*\.sql$/.test(entry));
const forwardMigration = forwardName ? readFileSync(`${directory}/${forwardName}`, 'utf8') : '';
const repairName = readdirSync(directory).find((entry) => /^0054_.*\.sql$/.test(entry));
const repairMigration = repairName ? readFileSync(`${directory}/${repairName}`, 'utf8') : '';

const nameMigrationName = readdirSync(directory).find((entry) => /^0068_.*\.sql$/.test(entry));
const nameMigration = nameMigrationName
  ? readFileSync(`${directory}/${nameMigrationName}`, 'utf8')
  : '';
const categoryDropName = readdirSync(directory).find((entry) => /^0069_.*\.sql$/.test(entry));
const categoryDropMigration = categoryDropName
  ? readFileSync(`${directory}/${categoryDropName}`, 'utf8')
  : '';

describe('ERP expense category removal migration', () => {
  it('names every expense and drops its category link', () => {
    expect(nameMigrationName).toBeDefined();
    expect(categoryDropName).toBeDefined();
    expect(nameMigration).toContain('ALTER TABLE `erp_expenses` ADD `name` varchar(255)');
    // No expense loses its wording: the old description names it.
    expect(nameMigration).toMatch(/UPDATE `erp_expenses`[\s\S]*SET `name` =/);
    expect(nameMigration).toContain('MODIFY COLUMN `name` varchar(255) NOT NULL');
    expect(nameMigration).toContain('erp_expenses_name_present');
    // The immutability guard stands aside while history is renamed, then goes
    // straight back: a run that stops between the two migrations must not leave
    // the ledger editable.
    expect(nameMigration).toContain('DROP TRIGGER `erp_expenses_guard_update`');
    expect(nameMigration).toContain('CREATE TRIGGER `erp_expenses_guard_update`');
    expect(nameMigration).toContain('OLD.`category_id` <=> NEW.`category_id`');
    expect(nameMigration).toContain('OLD.`name` <=> NEW.`name`');
    // The one 0069 installs replaces it, so it must drop that guard first.
    expect(categoryDropMigration).toContain('DROP TRIGGER `erp_expenses_guard_update`');
    expect(categoryDropMigration)
      .toContain('DROP FOREIGN KEY `erp_expenses_category_branch_fk`');
    expect(categoryDropMigration).toContain('DROP INDEX `erp_expenses_branch_category_date_idx`');
    expect(categoryDropMigration).toContain('DROP COLUMN `category_id`');
  });

  it('rewrites the guards and the correction procedure without the category', () => {
    // The immutability guard compares every column, so it must be recreated.
    expect(categoryDropMigration).toContain('CREATE TRIGGER `erp_expenses_guard_update`');
    expect(categoryDropMigration).toContain('OLD.`name` <=> NEW.`name`');
    expect(categoryDropMigration).not.toContain('OLD.`category_id` <=> NEW.`category_id`');
    expect(categoryDropMigration).toContain('DROP PROCEDURE `correct_erp_expense`');
    expect(categoryDropMigration).toContain('CREATE PROCEDURE `correct_erp_expense`');
    expect(categoryDropMigration).toContain('IN p_name varchar(255)');
    expect(categoryDropMigration).not.toContain('IN p_category_id');
  });

  it('retires the expense category type from the catalog', () => {
    expect(categoryDropMigration).toContain("DELETE FROM `erp_categories` WHERE `type` = 'expense'");
    expect(categoryDropMigration).toContain("MODIFY COLUMN `type` enum('service')");
  });
});

describe('ERP expenses migration', () => {
  it('creates branch-safe immutable facts with controlled correction status', () => {
    expect(migration).toContain('CREATE TABLE `erp_expenses`');
    expect(migration).toContain('erp_expenses_reversal_branch_fk');
    expect(migration).toContain('erp_expenses_supersedes_branch_fk');
    expect(migration).toContain('erp_expenses_reject_delete');
    expect(migration).toContain('erp_expenses_guard_update');
    expect(migration).toContain('erp_expenses_guard_insert');
    expect(migration).toContain("NEW.`status` = 'corrected'");
    expect(migration).toContain('NEW.`supersedes_id` IS NOT NULL');
    expect(forwardName).toBeDefined();
    expect(forwardMigration).toContain('correction_operation_id');
    expect(forwardMigration).toContain('CREATE TABLE `erp_expense_correction_guards`');
    expect(forwardMigration).toContain('CREATE PROCEDURE `correct_erp_expense`');
    expect(repairName).toBeDefined();
    expect(repairMigration).toContain('DROP PROCEDURE `correct_erp_expense`');
    expect(repairMigration).toContain('CREATE PROCEDURE `correct_erp_expense`');
    expect(repairMigration).toContain('IN p_description varchar(1000)');
    expect(forwardMigration).toContain('SQL SECURITY DEFINER');
    expect(forwardMigration).toContain('CONNECTION_ID()');
    expect(forwardMigration).toContain('SAVEPOINT erp_expense_correction_start');
    expect(forwardMigration).toContain('WHERE `connection_id` = 0');
    expect(forwardMigration).toContain('`erp_expense_correction_guards`');
    expect(forwardMigration).toContain('SET reversal.`correction_operation_id` = UUID()');
    expect(forwardMigration).toContain('SET replacement.`correction_operation_id` = reversal.`correction_operation_id`');
    expect(forwardMigration).not.toContain('OLD.`supersedes_id` IS NULL AND NEW.`supersedes_id` IS NOT NULL');
    expect(migration).toContain("OLD.`status` = 'active' AND NEW.`status` = 'corrected'");
    expect(migration).toContain("OLD.`kind` = 'expense'");
    expect(migration).toContain('reversal.`reversal_of_id` = OLD.`id`');
    expect(migration).toContain('replacement.`supersedes_id` = OLD.`id`');
    expect(migration).toContain("SIGNAL SQLSTATE '45000'");
  });
});
