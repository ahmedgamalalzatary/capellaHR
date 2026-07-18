import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';

import {
  advanceInstallments,
  advances,
  bonuses,
  deductions,
  employeeSalaryPeriods,
  financialAuditEvents,
  payrollMonths,
} from './index.js';

const config = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table);

describe('payroll schema', () => {
  it('defines the salary history and unique employee-month payroll snapshot tables', () => {
    expect(config(employeeSalaryPeriods).name).toBe('employee_salary_periods');
    expect(config(employeeSalaryPeriods).indexes.some((index) => index.config.name === 'employee_salary_periods_employee_month_unique')).toBe(true);
    expect(config(payrollMonths).name).toBe('payroll_months');
    expect(config(payrollMonths).indexes.some((index) => index.config.name === 'payroll_months_employee_month_unique')).toBe(true);
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
    expect(config(advances).checks.some((check) => check.name === 'advances_installment_count_range')).toBe(true);
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
});
