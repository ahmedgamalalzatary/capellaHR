import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
const name = readdirSync(directory).find((entry) => /^0049_.*\.sql$/.test(entry));

describe('ERP suppliers migration', () => {
  it('creates purchase facts and database immutability guards', () => {
    expect(name).toBeTruthy();
    const migration = readFileSync(`${directory}/${name!}`, 'utf8');
    expect(migration).toContain('CREATE TABLE `erp_suppliers`');
    expect(migration).toContain('CREATE TABLE `erp_purchases`');
    expect(migration).toContain('CREATE TABLE `erp_purchase_lines`');
    expect(migration).toContain('erp_purchases_reject_delete');
    expect(migration).toContain('erp_purchase_lines_reject_update');
    expect(migration).toContain('erp_purchase_lines_restrict_insert');
    expect(migration).toContain('erp_purchases_idempotency_unique');
    expect(migration).toContain('idempotency_fingerprint');
    expect(migration).toContain('SELECT SUM(`line_total`)');
    expect(migration).toContain('erp_purchases_validate_correction_insert');
    expect(migration).toContain('supplier_name_snapshot');
    expect(migration).toContain('previous_unit_cost');
    expect(migration).toContain("'purchase_cancellation'");
  });
});
