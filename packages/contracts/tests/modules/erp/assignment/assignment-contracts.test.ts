import { describe, expect, it } from 'vitest';

import { assignEmployeeSchema, listAssignableEmployeesQuerySchema } from '../../../../src/modules/erp/assignment/index.js';

describe('employee assignment contracts', () => {
  it('lets a cashier ask for their own branch without naming it', () => {
    expect(listAssignableEmployeesQuerySchema.parse({})).toEqual({});
  });

  it('coerces the branch an admin names in the query string', () => {
    expect(listAssignableEmployeesQuerySchema.parse({ branchId: '3' })).toEqual({ branchId: 3 });
  });

  it.each(['0', '-1', 'abc', '1.5'])('rejects %s as a branch identifier', (branchId) => {
    expect(listAssignableEmployeesQuerySchema.safeParse({ branchId }).success).toBe(false);
  });

  it('requires the employee an invoice is assigned to', () => {
    expect(assignEmployeeSchema.parse({ employeeId: 7 })).toEqual({ employeeId: 7 });
    expect(assignEmployeeSchema.safeParse({}).success).toBe(false);
  });

  /**
   * Assignment eligibility is strictly live attendance (`docs/erp-plan.md` §7),
   * so the contract must give neither role a field to bypass the check with.
   */
  it('offers no override field to a cashier or an admin', () => {
    expect(assignEmployeeSchema.safeParse({
      employeeId: 7,
      override: true,
    }).success).toBe(false);
    expect(assignEmployeeSchema.safeParse({
      employeeId: 7,
      forceAssignment: true,
    }).success).toBe(false);
  });
});
