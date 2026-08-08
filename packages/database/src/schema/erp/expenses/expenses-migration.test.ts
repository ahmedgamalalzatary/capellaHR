import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
const name = readdirSync(directory).find((entry) => /^0050_.*\.sql$/.test(entry));
if (!name) throw new Error('ERP 15 migration 0050 is missing');
const migration = readFileSync(`${directory}/${name}`, 'utf8');

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
    expect(migration).toContain('NEW.`supersedes_id` <> OLD.`id`');
    expect(migration).toContain("OLD.`status` = 'active' AND NEW.`status` = 'corrected'");
    expect(migration).toContain("OLD.`kind` = 'expense'");
    expect(migration).toContain('reversal.`reversal_of_id` = OLD.`id`');
    expect(migration).toContain('replacement.`supersedes_id` = OLD.`id`');
    expect(migration).toContain("SIGNAL SQLSTATE '45000'");
  });
});
