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
