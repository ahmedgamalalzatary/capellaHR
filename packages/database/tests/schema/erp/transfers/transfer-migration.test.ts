import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
const name = readdirSync(directory).find((entry) => /^0064_.*\.sql$/u.test(entry));
const settlementName = readdirSync(directory)
  .find((entry) => /^0097_transfer_internal_settlement\.sql$/u.test(entry));

describe('ERP stock transfer migration', () => {
  it('creates the transfer tables with their immutability guards', () => {
    expect(name).toBeTruthy();
    const migration = readFileSync(`${directory}/${name!}`, 'utf8');

    expect(migration).toContain('CREATE TABLE `erp_stock_transfers`');
    expect(migration).toContain('CREATE TABLE `erp_stock_transfer_lines`');
    expect(migration).toContain('erp_stock_transfers_idempotency_unique');
    expect(migration).toContain('erp_stock_transfers_branches_differ');
    expect(migration).toContain('erp_stock_transfers_posted_has_invoice');
    expect(migration).toContain('erp_stock_transfer_lines_restrict_insert');
    expect(migration).toContain('erp_stock_transfers_restrict_update');
    expect(migration).toContain('erp_stock_transfers_reject_delete');
    expect(migration).toContain('erp_stock_transfer_lines_reject_update');
    expect(migration).toContain('erp_stock_transfer_lines_reject_delete');
    expect(migration).toContain('SELECT SUM(`line_total`)');
  });

  it('teaches the movement log the receiving side of a transfer', () => {
    const migration = readFileSync(`${directory}/${name!}`, 'utf8');

    expect(migration).toContain("'transfer_in'");
    expect(migration).toContain('erp_stock_movements_reason_source_consistent');
    expect(migration).toContain('erp_stock_movements_direction_consistent');
  });

  it('moves existing transfers off the cash ledger and prevents new transfer payments', () => {
    expect(settlementName).toBeTruthy();
    const migration = readFileSync(`${directory}/${settlementName!}`, 'utf8');

    expect(migration).toContain('DROP TRIGGER IF EXISTS `erp_invoice_payments_validate_delete`');
    expect(migration).toContain('DROP TRIGGER IF EXISTS `erp_invoice_payments_validate_insert`');
    expect(migration).toContain("WHERE invoice.kind = 'branch_transfer'");
    expect(migration).toContain('`credited_amount` = `total`');
    expect(migration).toContain("IF invoice_kind = 'branch_transfer'");
    expect(migration).toContain('Branch transfers do not accept payments');
  });
});
