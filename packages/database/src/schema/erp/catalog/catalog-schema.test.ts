import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import { erpCategories, erpServiceCommissionOverrides, erpServices } from './index.js';

describe('erp categories schema', () => {
  it('exports one branch-scoped category table carrying its type', () => {
    expect(erpCategories.id).toBeDefined();
    expect(erpCategories.branchId).toBeDefined();
    expect(erpCategories.type).toBeDefined();
    expect(erpCategories.name).toBeDefined();
  });

  it('offers exactly the locked service and expense type values', () => {
    expect(erpCategories.type.enumValues).toEqual(['service', 'expense']);
  });

  it('makes the category name unique within one type of one branch', () => {
    const unique = getTableConfig(erpCategories).indexes
      .find((entry) => entry.config.name === 'erp_categories_branch_type_name_unique');

    expect(unique?.config.unique).toBe(true);
    // Index columns are `MySqlColumn | SQL`; only the column form carries a name.
    expect(unique?.config.columns.map((column) => ('name' in column ? column.name : null)))
      .toEqual(['branch_id', 'type', 'name_normalized']);
  });

  it('carries an active flag so a retired category is deactivated rather than removed', () => {
    const columns = getTableConfig(erpCategories).columns.map((column) => column.name);

    expect(columns).toContain('is_active');
    expect(columns).not.toContain('deleted_at');
  });

  it('carries the permanent reference flag that blocks deleting a used category', () => {
    const columns = getTableConfig(erpCategories).columns.map((column) => column.name);

    expect(columns).toContain('has_ever_been_referenced');
  });
});

describe('erp services schema', () => {
  it('stores the locked service facts including its category and active state', () => {
    const columns = getTableConfig(erpServices).columns.map((column) => column.name);

    expect(columns).toEqual(expect.arrayContaining([
      'branch_id', 'category_id', 'name', 'description', 'price', 'commission_percent', 'is_active',
    ]));
  });

  it('stores the price as exact decimal EGP rather than a float', () => {
    const price = getTableConfig(erpServices).columns.find((column) => column.name === 'price');

    expect(price?.getSQLType()).toBe('decimal(12,2)');
  });

  it('stores the default commission rate as an exact decimal percentage', () => {
    const rate = getTableConfig(erpServices).columns
      .find((column) => column.name === 'commission_percent');

    expect(rate?.getSQLType()).toBe('decimal(5,2)');
  });

  it('rejects a non-positive price and an out-of-range commission at the column level', () => {
    const names = getTableConfig(erpServices).checks.map((constraint) => constraint.name);

    expect(names).toContain('erp_services_price_positive');
    expect(names).toContain('erp_services_commission_range');
  });

  it('makes the service name unique inside its branch', () => {
    const unique = getTableConfig(erpServices).indexes
      .find((entry) => entry.config.name === 'erp_services_branch_name_unique');

    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((column) => ('name' in column ? column.name : null)))
      .toEqual(['branch_id', 'name_normalized']);
  });

  it('has no delete column, because invoices snapshot services that must stay resolvable', () => {
    const columns = getTableConfig(erpServices).columns.map((column) => column.name);

    expect(columns).not.toContain('deleted_at');
  });
});

describe('erp service commission override schema', () => {
  it('keeps at most one override per employee per service', () => {
    const unique = getTableConfig(erpServiceCommissionOverrides).indexes
      .find((entry) => entry.config.name === 'erp_service_commission_overrides_unique');

    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((column) => ('name' in column ? column.name : null)))
      .toEqual(['service_id', 'employee_id']);
  });

  it('stores the override rate as an exact decimal percentage in range', () => {
    const rate = getTableConfig(erpServiceCommissionOverrides).columns
      .find((column) => column.name === 'commission_percent');
    const names = getTableConfig(erpServiceCommissionOverrides).checks
      .map((constraint) => constraint.name);

    expect(rate?.getSQLType()).toBe('decimal(5,2)');
    expect(names).toContain('erp_service_commission_overrides_range');
  });
});
