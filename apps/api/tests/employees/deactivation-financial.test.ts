import { describe, expect, it } from 'vitest';

import { projectDeactivationBalance } from '../../src/modules/employees/deactivation-financial.js';

describe('employee deactivation financial projection', () => {
  it('replaces future installments with the combined amount in the current payroll', () => {
    expect(projectDeactivationBalance('1000.00', '1500.00', '500.00')).toEqual({
      projectedNetSalary: '0.00',
      amountOwed: '0.00',
    });
    expect(projectDeactivationBalance('500.00', '1500.00', '500.00')).toEqual({
      projectedNetSalary: '-500.00',
      amountOwed: '500.00',
    });
  });

  it('does not double-count an installment already included in current payroll', () => {
    expect(projectDeactivationBalance('2500.00', '500.00', '500.00')).toEqual({
      projectedNetSalary: '2500.00',
      amountOwed: '0.00',
    });
  });
});
