import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const migrationName = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .find((name) => name.startsWith('0062_'));
if (!migrationName) throw new Error('Cashier control migration 0062 is missing');
const migration = readFileSync(`${migrationsDirectory}/${migrationName}`, 'utf8');

describe('cashier control migration', () => {
  it('adds the system close marker to cashier shifts', () => {
    expect(migration).toContain('`erp_cashier_sessions` ADD `auto_closed_at`');
  });

  it('lets a closed shift name either a closing account or the system', () => {
    expect(migration).toContain('DROP CONSTRAINT `erp_cashier_sessions_close_state`');
    expect(migration).toContain('ADD CONSTRAINT `erp_cashier_sessions_close_state`');
    expect(migration).toMatch(/auto_closed_at` is not null/);
  });

  it('retires every extra branch login so each branch keeps exactly one', () => {
    // Existing servers may carry disabled leftovers beside the live login.
    expect(migration).toMatch(/UPDATE `accounts`/);
    expect(migration).toMatch(/`role` = 'cashier'/);
    expect(migration).toMatch(/`employee_id` IS NULL/);
    expect(migration).toContain('archived_at');
    // The keeper is the live login, or the earliest one when none is active.
    expect(migration).toMatch(/MIN\(|ORDER BY/);
  });

  it('revokes the sessions of the branch logins it retires', () => {
    expect(migration).toMatch(/UPDATE `auth_sessions`/);
    expect(migration).toMatch(/revoked_at/);
  });

  it('archives accounts by freeing the username without deleting the row', () => {
    expect(migration).toContain('`accounts` ADD `archived_at`');
    expect(migration).toContain('`accounts` ADD `active_username`');
    expect(migration).toContain('DROP INDEX `accounts_username_unique`');
    expect(migration).toContain('`accounts_active_username_unique`');
  });
});
