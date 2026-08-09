import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableConfig, MySqlDialect } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import {
  advanceInstallments,
  advances,
  bonuses,
  deductions,
  employeeDeactivationAdjustments,
  employeeOutstandingDebts,
  employeePendingDeactivations,
  employeeSalaryPeriods,
  erpCommissionPayrollInputs,
  erpPostPayrollDeductions,
  financialAuditEvents,
  payrollMonths,
} from './index.js';

const config = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table);
const dialect = new MySqlDialect();
const migrationsDirectory = fileURLToPath(new URL('../../../migrations/', import.meta.url));
const erp17MigrationName = readdirSync(migrationsDirectory).find((name) => /^0056_.*\.sql$/.test(name));
if (!erp17MigrationName) throw new Error('ERP 17 migration 0056 is missing');
const erp17Migration = readFileSync(`${migrationsDirectory}/${erp17MigrationName}`, 'utf8');
const checkSql = (table: Parameters<typeof getTableConfig>[0], name: string) => {
  const constraint = config(table).checks.find((check) => check.name === name);
  return constraint ? dialect.sqlToQuery(constraint.value).sql : null;
};

describe('payroll schema', () => {
  it('stores an optional historical reason on bonus rows', () => {
    const reason = config(bonuses).columns.find((column) => column.name === 'reason');
    expect(reason).toBeDefined();
    expect(reason?.notNull).toBe(false);
  });

  it('supports month-first dashboard financial scans', () => {
    expect(config(bonuses).indexes.some((item) => item.config.name === 'bonuses_month_employee_idx')).toBe(true);
    expect(config(deductions).indexes.some((item) => item.config.name === 'deductions_month_employee_idx')).toBe(true);
    expect(config(advanceInstallments).indexes.some((item) => item.config.name === 'advance_installments_month_employee_idx')).toBe(true);
  });

  it('defines the salary history and unique employee-month payroll snapshot tables', () => {
    expect(config(employeeSalaryPeriods).name).toBe('employee_salary_periods');
    expect(config(employeeSalaryPeriods).indexes.some((index) => index.config.name === 'employee_salary_periods_employee_month_unique')).toBe(true);
    expect(config(payrollMonths).name).toBe('payroll_months');
    expect(config(payrollMonths).indexes.some((index) => index.config.name === 'payroll_months_employee_month_unique')).toBe(true);
  });

  it('stores idempotent ERP commission inputs and post-payroll deductions in HR-owned tables', () => {
    expect(config(erpCommissionPayrollInputs).name).toBe('erp_commission_payroll_inputs');
    expect(config(erpCommissionPayrollInputs).indexes
      .some((index) => index.config.name === 'erp_commission_payroll_inputs_reference_unique')).toBe(true);
    expect(config(erpCommissionPayrollInputs).indexes
      .some((index) => index.config.name === 'erp_commission_payroll_inputs_employee_month_unique')).toBe(true);
    expect(config(erpPostPayrollDeductions).name).toBe('erp_post_payroll_deductions');
    expect(config(erpPostPayrollDeductions).indexes
      .some((index) => index.config.name === 'erp_post_payroll_deductions_reference_unique')).toBe(true);
    expect(config(payrollMonths).columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'commission_amount', 'commission_deduction_amount',
    ]));
  });

  it('backfills only open payroll commission inputs from existing immutable ledger facts', () => {
    expect(erp17Migration).toContain('INSERT INTO `erp_commission_payroll_inputs`');
    expect(erp17Migration).toContain('FROM `erp_commission_ledger_entries` ledger');
    expect(erp17Migration).toContain('INNER JOIN `erp_invoices` invoice');
    expect(erp17Migration).toContain('LEFT JOIN `payroll_months` payroll');
    expect(erp17Migration).toContain('WHERE payroll.`id` IS NULL');
    expect(erp17Migration).toContain("CONCAT('erp-commission:'");
  });

  it.each([
    [bonuses, 'bonuses', 'bonuses_amount_positive'],
    [deductions, 'deductions', 'deductions_amount_positive'],
    [advances, 'advances', 'advances_amount_positive'],
    [advanceInstallments, 'advance_installments', 'advance_installments_amount_positive'],
  ] as const)('defines %s with a positive amount constraint', (table, name, checkName) => {
    const tableConfig = config(table);
    expect(tableConfig.name).toBe(name);
    expect(tableConfig.checks.some((check) => check.name === checkName)).toBe(true);
  });

  it('constrains advance count and installment uniqueness', () => {
    expect(checkSql(advances, 'advances_installment_count_range'))
      .toBe('`advances`.`installment_count` between 1 and 12');
    expect(checkSql(advanceInstallments, 'advance_installments_ordinal_range'))
      .toBe('`advance_installments`.`ordinal` between 1 and 12');
    expect(config(advances).indexes.some((index) => index.config.name === 'advances_id_employee_unique')).toBe(true);
    expect(config(advanceInstallments).indexes.some((index) => index.config.name === 'advance_installments_advance_ordinal_unique')).toBe(true);
    expect(config(advanceInstallments).indexes.some((index) => index.config.name === 'advance_installments_advance_month_unique')).toBe(true);
    expect(config(advanceInstallments).foreignKeys.map((foreignKey) => foreignKey.reference()))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        name: 'advance_installments_advance_employee_fk',
        columns: [advanceInstallments.advanceId, advanceInstallments.employeeId],
        foreignColumns: [advances.id, advances.employeeId],
      })]));
  });

  it('defines append-only financial audit storage', () => {
    expect(config(financialAuditEvents).name).toBe('financial_audit_events');
    expect(config(financialAuditEvents).columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'entity_type', 'entity_id', 'action', 'before_state', 'after_state', 'created_at',
    ]));
  });

  it('stores signed deactivation adjustments separately and snapshots them in payroll', () => {
    expect(config(employeeDeactivationAdjustments).name).toBe('employee_deactivation_adjustments');
    // Signed on purpose: a write-off or cash payment credits the employee, a forfeited salary
    // debits it, so a positivity check would reject half the decision tree.
    expect(config(employeeDeactivationAdjustments).checks
      .some((check) => check.name === 'employee_deactivation_adjustments_amount_nonzero')).toBe(true);
    expect(config(employeeDeactivationAdjustments).indexes
      .some((index) => index.config.name === 'employee_deactivation_adjustments_employee_month_reason_unique')).toBe(true);
    expect(config(payrollMonths).columns
      .some((column) => column.name === 'deactivation_adjustment_amount')).toBe(true);
  });

  it('records an outstanding debt that survives deactivation without touching payroll', () => {
    expect(config(employeeOutstandingDebts).name).toBe('employee_outstanding_debts');
    expect(config(employeeOutstandingDebts).checks
      .some((check) => check.name === 'employee_outstanding_debts_amount_positive')).toBe(true);
    expect(config(employeeOutstandingDebts).indexes
      .some((index) => index.config.name === 'employee_outstanding_debts_employee_month_unique')).toBe(true);
  });

  it('holds a pending deactivation until the open session closes', () => {
    expect(config(employeePendingDeactivations).name).toBe('employee_pending_deactivations');
    expect(config(employeePendingDeactivations).columns.map((column) => column.name))
      .toEqual(expect.arrayContaining([
        'employee_id', 'advance_decision', 'negative_balance_decision', 'requested_at',
      ]));
    expect(config(employeePendingDeactivations).indexes
      .some((index) => index.config.name === 'employee_pending_deactivations_employee_unique')).toBe(true);
  });
});
