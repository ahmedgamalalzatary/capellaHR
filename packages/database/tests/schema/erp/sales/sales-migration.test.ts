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
const migration51Name = readdirSync(migrationsDirectory).find((name) => /^0051_.*\.sql$/.test(name));
if (!migration51Name) throw new Error('ERP 16 reversal migration 0051 is missing');
const reversalMigration = readFileSync(`${migrationsDirectory}/${migration51Name}`, 'utf8');
const migration52Name = readdirSync(migrationsDirectory).find((name) => /^0052_.*\.sql$/.test(name));
if (!migration52Name) throw new Error('ERP 16 commission-link migration 0052 is missing');
const commissionLinkMigration = readFileSync(`${migrationsDirectory}/${migration52Name}`, 'utf8');
const migration54Name = readdirSync(migrationsDirectory).find((name) => /^0054_.*\.sql$/.test(name));
const reversalRepairMigration = migration54Name
  ? readFileSync(`${migrationsDirectory}/${migration54Name}`, 'utf8')
  : '';
const migration55Name = readdirSync(migrationsDirectory).find((name) => /^0055_.*\.sql$/.test(name));
const ownershipRepairMigration = migration55Name
  ? readFileSync(`${migrationsDirectory}/${migration55Name}`, 'utf8')
  : '';
const optionalEmployeeMigrationName = readdirSync(migrationsDirectory)
  .find((name) => /^0059_.*\.sql$/.test(name));
const optionalEmployeeMigration = optionalEmployeeMigrationName
  ? readFileSync(`${migrationsDirectory}/${optionalEmployeeMigrationName}`, 'utf8')
  : '';

const lineEmployeeMigrationName = readdirSync(migrationsDirectory)
  .find((name) => /^0067_.*\.sql$/.test(name));
const lineEmployeeMigration = lineEmployeeMigrationName
  ? readFileSync(`${migrationsDirectory}/${lineEmployeeMigrationName}`, 'utf8')
  : '';
const reassignmentMigrationName = readdirSync(migrationsDirectory)
  .find((name) => /^0076_.*\.sql$/.test(name));
const reassignmentMigration = reassignmentMigrationName
  ? readFileSync(`${migrationsDirectory}/${reassignmentMigrationName}`, 'utf8')
  : '';

describe('ERP invoice-line reassignment migration', () => {
  it('adds immutable reassignment facts and linked commission movements', () => {
    expect(reassignmentMigrationName).toBeDefined();
    expect(reassignmentMigration).toContain('CREATE TABLE `erp_invoice_line_reassignments`');
    expect(reassignmentMigration).toContain('erp_invoice_line_reassignments_line_operation_unique');
    expect(reassignmentMigration).toContain(
      'UNIQUE(`operation_reference`)',
    );
    expect(reassignmentMigration).toContain("enum('earned','reversal','reassignment_out','reassignment_in')");
    expect(reassignmentMigration).toContain('invoice_line_reassignment_id');
    expect(reassignmentMigration).toContain('erp_commission_ledger_line_reassignment_fk');
  });

  it('guards reassignment history and the matching ledger pair', () => {
    expect(reassignmentMigration).toContain('erp_invoice_line_reassignments_validate_insert');
    expect(reassignmentMigration).toContain('Reassignment source employee is not current');
    expect(reassignmentMigration).toContain("invoice_status <> 'completed'");
    expect(reassignmentMigration).toContain('erp_invoice_line_reassignments_reject_update');
    expect(reassignmentMigration).toContain('erp_invoice_line_reassignments_reject_delete');
    expect(reassignmentMigration).toContain('erp_commission_ledger_entry_consistent');
    expect(reassignmentMigration).toContain('reassignment_out');
    expect(reassignmentMigration).toContain('reassignment_in');
  });
});

describe('ERP per-line employee migration', () => {
  it('moves the performing employee from the invoice onto each service line', () => {
    expect(lineEmployeeMigrationName).toBeDefined();
    expect(lineEmployeeMigration).toContain(
      'ALTER TABLE `erp_invoice_lines` ADD `employee_id` int',
    );
    expect(lineEmployeeMigration).toContain(
      'ALTER TABLE `erp_invoice_lines` ADD `employee_name_snapshot` varchar(255)',
    );
    expect(lineEmployeeMigration).toContain(
      'ALTER TABLE `erp_invoice_lines` ADD `employee_code_snapshot` int',
    );
    expect(lineEmployeeMigration).toContain('erp_invoice_lines_employee_branch_fk');
    expect(lineEmployeeMigration).toContain('erp_invoice_lines_employee_consistent');
    expect(lineEmployeeMigration).toContain('erp_invoice_lines_employee_idx');
  });

  it('backfills existing service lines from the invoice they belong to', () => {
    expect(lineEmployeeMigration).toContain('UPDATE `erp_invoice_lines`');
    expect(lineEmployeeMigration).toMatch(/SET[\s\S]*`employee_id`\s*=\s*`invoice`\.`assigned_employee_id`/);
    // The line-immutability guard must stand aside while history is rewritten.
    expect(lineEmployeeMigration).toContain('DROP TRIGGER `erp_invoice_lines_validate_update`');
    expect(lineEmployeeMigration).toContain('CREATE TRIGGER `erp_invoice_lines_validate_update`');
  });

  it('drops the invoice-level employee columns and their constraints', () => {
    expect(lineEmployeeMigration).toContain('DROP FOREIGN KEY `erp_invoices_employee_branch_fk`');
    expect(lineEmployeeMigration).toContain('DROP INDEX `erp_invoices_employee_sold_idx`');
    expect(lineEmployeeMigration)
      .toContain('DROP CONSTRAINT `erp_invoices_employee_assignment_consistent`');
    expect(lineEmployeeMigration).toContain('DROP COLUMN `assigned_employee_id`');
    expect(lineEmployeeMigration).toContain('DROP COLUMN `employee_name_snapshot`');
    expect(lineEmployeeMigration).toContain('DROP COLUMN `employee_code_snapshot`');
  });

  it('re-points the guards that used the invoice-level employee', () => {
    // Commission must now match the employee named on its own service line.
    expect(lineEmployeeMigration).toContain('DROP TRIGGER `erp_commission_ledger_validate_insert`');
    expect(lineEmployeeMigration).toContain('line.employee_id = NEW.employee_id');
    expect(lineEmployeeMigration).not.toContain('invoice.assigned_employee_id = NEW.employee_id');
    // Completion still refuses a service nobody performed.
    expect(lineEmployeeMigration)
      .toContain('DROP TRIGGER `erp_invoices_validate_employee_assignment`');
    expect(lineEmployeeMigration).toContain('Every service line requires an employee');
    // The immutability guard can no longer compare dropped invoice columns.
    expect(lineEmployeeMigration).toContain('DROP TRIGGER `erp_invoices_validate_lifecycle`');
    expect(lineEmployeeMigration).not.toContain('NEW.assigned_employee_id <=> OLD.assigned_employee_id');
    // A completed invoice's seller is a fact like any other: an invoice that was
    // completed without one must not gain one afterwards.
    expect(lineEmployeeMigration).toContain('NEW.seller_employee_id <=> OLD.seller_employee_id');
    expect(lineEmployeeMigration).toContain('NEW.seller_name_snapshot <=> OLD.seller_name_snapshot');
  });
});

describe('ERP sales migration', () => {
  it('allows employee-free product invoices while guarding service assignment', () => {
    expect(optionalEmployeeMigrationName).toBeDefined();
    expect(optionalEmployeeMigration).toContain('assigned_employee_id');
    expect(optionalEmployeeMigration).toContain('employee_name_snapshot');
    expect(optionalEmployeeMigration).toContain('employee_code_snapshot');
    expect(optionalEmployeeMigration).toContain('erp_invoices_employee_assignment_consistent');
    expect(optionalEmployeeMigration).toContain('Every service invoice requires an employee');
    expect(optionalEmployeeMigration).toContain('Product-only invoices cannot have an employee');
  });
  it('requires invoices to be inserted as drafts before completion validation can run', () => {
    expect(optionalEmployeeMigration).toContain(
      'CREATE TRIGGER `erp_invoices_require_draft_on_insert`',
    );
    expect(optionalEmployeeMigration).toContain('BEFORE INSERT ON `erp_invoices`');
    expect(optionalEmployeeMigration).toContain("IF NEW.status <> 'draft' THEN");
    expect(optionalEmployeeMigration).toContain('New invoices must start as draft');
    expect(optionalEmployeeMigration).toContain(
      'CREATE TRIGGER `erp_invoices_validate_employee_assignment`',
    );
    expect(optionalEmployeeMigration).toContain('BEFORE UPDATE ON `erp_invoices`');
  });
  it('guards normalized reversal facts and invoice lifecycle transitions', () => {
    for (const table of [
      'erp_invoice_reversals', 'erp_invoice_reversal_lines',
      'erp_invoice_reversal_payments',
    ]) expect(reversalMigration).toContain(`CREATE TABLE \`${table}\``);
    expect(reversalMigration).toContain('erp_invoice_reversals_validate_finalize');
    expect(reversalMigration).toContain('erp_invoice_reversals_apply_finalize');
    expect(reversalMigration).toContain('erp_invoice_reversals_reject_delete');
    expect(reversalMigration).toContain('erp_invoice_reversal_lines_reject_update');
    expect(reversalMigration).toContain('erp_invoice_reversal_payments_reject_delete');
    expect(reversalMigration).toContain('DROP TRIGGER `erp_invoices_validate_completion`');
    expect(reversalMigration).toContain('Invoice reversal totals are incomplete');
    expect(reversalMigration).toContain('Invoice refunded quantities are inconsistent');
    expect(reversalMigration).toContain('Invoice reversed payments are inconsistent');
    expect(reversalMigration).toContain("reversal.status = 'pending'");
    expect(reversalMigration).toContain('Invoice reversal stock restoration is incomplete');
    expect(reversalMigration).toContain('Invoice reversal commission facts are incomplete');
    expect(reversalMigration).toContain('Void business date is invalid');
    expect(migration54Name).toBeDefined();
    expect(reversalRepairMigration).toContain('DROP TRIGGER `erp_invoice_reversals_validate_finalize`');
    expect(reversalRepairMigration).toContain('CREATE TRIGGER `erp_invoice_reversals_validate_finalize`');
    expect(reversalRepairMigration).toContain('prior_reversal.invoice_id = NEW.invoice_id');
    expect(migration55Name).toBeDefined();
    expect(ownershipRepairMigration).toContain('reversal_line.invoice_id = NEW.invoice_id');
    expect(ownershipRepairMigration).toContain('reversal_line.branch_id = NEW.branch_id');
    expect(ownershipRepairMigration).toContain('original_line.invoice_id = NEW.invoice_id');
    expect(ownershipRepairMigration).toContain('invoice.branch_id = NEW.branch_id');
    expect(ownershipRepairMigration).toContain('payment.invoice_id = NEW.invoice_id');
    expect(ownershipRepairMigration).toContain('NOT EXISTS (SELECT 1 FROM `erp_product_stocks` stock');
    expect(ownershipRepairMigration).toContain('earned.id = ledger.reverses_entry_id');
    expect(ownershipRepairMigration).toContain('ledger.invoice_reversal_id = commission_line.reversal_id');
    expect(ownershipRepairMigration).toContain('ledger.invoice_reversal_id = NEW.id');
    expect(ownershipRepairMigration).toContain('ledger.employee_id = earned.employee_id');
    expect(ownershipRepairMigration).toContain('ledger.commission_rule_snapshot = earned.commission_rule_snapshot');
    expect(ownershipRepairMigration).toContain('ledger.commission_rate_snapshot = earned.commission_rate_snapshot');
    expect(ownershipRepairMigration).toContain('-ledger.amount <> ROUND(');
    expect(ownershipRepairMigration).not.toContain('PARTITION BY prior.reverses_entry_id ORDER BY prior.id');
  });

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
    expect(commissionLinkMigration).toContain('target_amount');
    expect(commissionLinkMigration).toContain('reversed_base');
    expect(commissionLinkMigration).toContain('ROUND((reversed_base + NEW.base_amount)');
  });

  it('links each commission reversal to its pending invoice reversal', () => {
    expect(commissionLinkMigration).toContain('invoice_reversal_id');
    expect(commissionLinkMigration).toContain('erp_commission_ledger_invoice_reversal_fk');
    expect(commissionLinkMigration).toContain('erp_invoice_reversals_validate_commission_link');
    expect(commissionLinkMigration).toContain('Commission reversal requires a pending invoice reversal');
    expect(commissionLinkMigration).toContain('Invoice reversal commission link is incomplete');
  });

  it('preserves service category ownership inside the same branch', () => {
    expect(hardeningMigration).toContain('erp_categories_id_branch_unique');
    expect(hardeningMigration).toContain('DROP FOREIGN KEY `erp_services_category_id_erp_categories_id_fk`');
    expect(hardeningMigration).toContain('erp_services_category_branch_fk');
  });
});
