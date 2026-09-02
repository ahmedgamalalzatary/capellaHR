import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isolatedSuites = [
  'tests/erp/booking-mysql.integration.test.ts',
  'tests/erp/cashier-sessions-repository-mysql.integration.test.ts',
  'tests/erp/consumables-mysql.integration.test.ts',
  'tests/erp/erp-reports-mysql.integration.test.ts',
  'tests/erp/expenses-mysql.integration.test.ts',
  'tests/erp/fixed-assets-mysql.integration.test.ts',
  'tests/erp/sale-repository-mysql.integration.test.ts',
  'tests/erp/sale-repository-completion-mysql.integration.test.ts',
  'tests/erp/sale-repository-finalization-mysql.integration.test.ts',
  'tests/erp/sale-repository-reversals-mysql.integration.test.ts',
  'tests/erp/sales-foundation-mysql.integration.test.ts',
  'tests/erp/stock-transfer-mysql.integration.test.ts',
  'tests/erp/suppliers-mysql.integration.test.ts',
  'tests/payroll/erp-payroll-capability-mysql.integration.test.ts',
];

describe('MySQL integration harness', () => {
  it.each(isolatedSuites)('reuses the globally migrated database in %s', (relativePath) => {
    const source = readFileSync(path.join(apiRoot, relativePath), 'utf8');

    expect(source).toContain("from '../mysql-integration-database.js'");
    expect(source).not.toContain('CREATE DATABASE');
    expect(source).not.toMatch(/\bmigrate\s*\(/u);
  });

  it('keeps the historical expense backfill on its purpose-built migration database', () => {
    const source = readFileSync(path.join(
      apiRoot,
      'tests/erp/expense-name-backfill-mysql.integration.test.ts',
    ), 'utf8');

    expect(source).toContain('Number(tag.slice(0, 4)) <= 67');
    expect(source).toContain('Number(tag.slice(0, 4)) >= 68');
  });
});
