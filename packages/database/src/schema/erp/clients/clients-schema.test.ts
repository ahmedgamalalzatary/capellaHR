import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { clients } from './index.js';

describe('clients schema', () => {
  it('exports the branch-scoped client table', () => {
    expect(clients.id).toBeDefined();
    expect(clients.branchId).toBeDefined();
    expect(clients.fullName).toBeDefined();
    expect(clients.phone).toBeDefined();
  });

  it('scopes phone uniqueness to the branch so two branches may hold the same number', () => {
    const unique = getTableConfig(clients).indexes
      .find((entry) => entry.config.name === 'clients_branch_phone_unique');

    expect(unique?.config.unique).toBe(true);
    // Index columns are `MySqlColumn | SQL`; only the column form carries a name.
    expect(unique?.config.columns.map((column) => ('name' in column ? column.name : null)))
      .toEqual(['branch_id', 'phone']);
  });

  it('constrains phone to the locked normalized Egyptian mobile form', () => {
    const names = getTableConfig(clients).checks.map((constraint) => constraint.name);

    expect(names).toContain('clients_phone_format');
  });

  it('has no soft-delete column, because clients referenced by invoices are never removed', () => {
    const columns = getTableConfig(clients).columns.map((column) => column.name);

    expect(columns).not.toContain('deleted_at');
  });
});
