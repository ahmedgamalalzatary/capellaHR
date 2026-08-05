import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
const name = readdirSync(directory).find((entry) => /^0048_.*\.sql$/.test(entry));
if (!name) throw new Error('ERP 13 migration 0048 is missing');
const migration = readFileSync(`${directory}/${name}`, 'utf8');

describe('ERP stock migration', () => {
  it('creates balances and an append-only movement ledger', () => {
    expect(migration).toContain('CREATE TABLE `erp_product_stocks`');
    expect(migration).toContain('CREATE TABLE `erp_stock_movements`');
    expect(migration).toContain('erp_stock_movements_reject_update');
    expect(migration).toContain('erp_stock_movements_reject_delete');
    expect(migration).toContain('erp_stock_movements_reason_source_consistent');
    expect(migration).toContain('erp_stock_movements_direction_consistent');
    expect(migration).toContain("SIGNAL SQLSTATE '45000'");
  });
});
