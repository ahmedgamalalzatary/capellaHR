import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
const migrationName = readdirSync(migrationsDirectory).find((name) => /^0046_.*\.sql$/.test(name));
if (!migrationName) throw new Error('ERP 8 migration 0046 is missing');
const migrationPath = `${migrationsDirectory}/${migrationName}`;
const migration = readFileSync(migrationPath, 'utf8');
const migration47Name = readdirSync(migrationsDirectory).find((name) => /^0047_.*\.sql$/.test(name));
if (!migration47Name) throw new Error('ERP 8 hardening migration 0047 is missing');
const hardeningMigration = readFileSync(`${migrationsDirectory}/${migration47Name}`, 'utf8');

describe('ERP sales migration', () => {
  it('creates every ERP 8 persistence table', () => {
    for (const table of [
      'erp_products',
      'erp_invoices',
      'erp_invoice_lines',
      'erp_invoice_payments',
      'erp_invoice_daily_sequences',
      'erp_commission_ledger_entries',
    ]) {
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    }
  });

  it('enforces the commission ledger as append-only in MySQL', () => {
    expect(migration).toContain('erp_commission_ledger_validate_insert');
    expect(migration).toContain('erp_commission_ledger_reject_update');
    expect(migration).toContain('erp_commission_ledger_reject_delete');
    expect(migration).toContain("SIGNAL SQLSTATE '45000'");
  });

  it('allows completion only after payment rows exactly cover the invoice total', () => {
    expect(migration).toContain('erp_invoices_validate_completion');
    expect(migration).toContain('SUM(amount)');
    expect(migration).toContain('Invoice payments must exactly cover the total');
    expect(migration).toContain('Invoice lines must exactly cover the subtotal');
    expect(migration).toContain('Every service line requires earned commission');
  });

  it('locks the payment breakdown after an invoice leaves draft', () => {
    expect(migration).toContain('erp_invoice_payments_validate_insert');
    expect(migration).toContain('erp_invoice_payments_validate_update');
    expect(migration).toContain('erp_invoice_payments_validate_delete');
    expect(migration).toContain('Completed invoice payments are immutable');
  });

  it('locks completed invoice facts and permits only draft-to-completed transition', () => {
    expect(migration).toContain('Invoice status transition is invalid');
    expect(migration).toContain('Completed invoice facts are immutable');
    expect(migration).toContain('erp_invoices_reject_delete');
    expect(migration).toContain('erp_invoice_lines_validate_insert');
    expect(migration).toContain('erp_invoice_lines_validate_update');
    expect(migration).toContain('erp_invoice_lines_validate_delete');
  });

  it('uses cumulative rounding for commission reversals', () => {
    expect(migration).toContain('target_amount');
    expect(migration).toContain('reversed_base');
    expect(migration).toContain('ROUND((reversed_base + NEW.base_amount)');
  });

  it('preserves service category ownership inside the same branch', () => {
    expect(hardeningMigration).toContain('erp_categories_id_branch_unique');
    expect(hardeningMigration).toContain('DROP FOREIGN KEY `erp_services_category_id_erp_categories_id_fk`');
    expect(hardeningMigration).toContain('erp_services_category_branch_fk');
  });
});
