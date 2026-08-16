import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const migrationName = readdirSync(migrationsDirectory).find((name) => /^0060_.*\.sql$/.test(name));
if (!migrationName) throw new Error('Branch cashier migration 0060 is missing');
const migration = readFileSync(`${migrationsDirectory}/${migrationName}`, 'utf8');

describe('branch cashier migration', () => {
  it('moves cashier accounts to one active branch login per branch', () => {
    expect(migration).toContain('ADD `branch_id`');
    expect(migration).toContain('active_cashier_branch');
    expect(migration).toContain('accounts_active_cashier_branch_unique');
    expect(migration).toContain('accounts_role_scope_consistency');
    expect(migration).toContain('accounts_branch_fk');
  });

  it('deactivates legacy employee cashier logins and revokes their sessions', () => {
    expect(migration).toMatch(/UPDATE `accounts` SET `active` = false/);
    expect(migration).toMatch(/`role` = 'cashier'/);
    expect(migration).toMatch(/`employee_id` IS NOT NULL/);
    expect(migration).toContain('UPDATE `auth_sessions`');
    expect(migration).toContain('`revoked_at`');
  });

  it('creates the per-branch cashier roster', () => {
    expect(migration).toContain('CREATE TABLE `erp_branch_cashier_roster`');
    expect(migration).toContain('erp_branch_cashier_roster_branch_employee_unique');
    expect(migration).toContain('erp_branch_cashier_roster_employee_branch_fk');
  });

  it('records the selling employee on every completed invoice', () => {
    expect(migration).toContain('ADD `seller_employee_id`');
    expect(migration).toContain('ADD `seller_name_snapshot`');
    expect(migration).toContain('erp_invoices_seller_consistent');
    expect(migration).toContain('erp_invoices_seller_branch_fk');
    expect(migration).toContain('erp_invoices_validate_seller_assignment');
    expect(migration).toContain('erp_invoices_validate_seller_insert');
    expect(migration).toContain("NEW.status <> 'draft' AND NEW.seller_employee_id IS NULL");
    expect(migration).toContain("OLD.status = 'draft' AND NEW.status <> 'draft'");
    expect(migration).toContain("OLD.status <> 'draft' AND NEW.status = 'draft'");
    expect(migration).toContain('Completed invoices require a seller');
  });
});
