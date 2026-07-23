import { describe, expect, test } from 'vitest';

import {
  adjustmentCreateFormSchema,
  adjustmentUpdateFormSchema,
  bonusAdjustmentCreateFormSchema,
  bonusAdjustmentUpdateFormSchema,
} from '../src/features/financial-adjustments/schemas/adjustment-form';

describe('adjustmentCreateFormSchema', () => {
  test('accepts an employee, a positive amount, and a payroll month', () => {
    expect(
      adjustmentCreateFormSchema.parse({ employeeId: '1', amount: ' 250.50 ', payrollMonth: '2026-06' }),
    ).toEqual({ employeeId: 1, amount: '250.50', payrollMonth: '2026-06' });
  });

  test('rejects a missing employee, non-positive amounts, and malformed months', () => {
    const valid = { employeeId: '1', amount: '100', payrollMonth: '2026-06' };
    expect(adjustmentCreateFormSchema.safeParse({ ...valid, employeeId: '' }).success).toBe(false);
    expect(adjustmentCreateFormSchema.safeParse({ ...valid, amount: '0' }).success).toBe(false);
    expect(adjustmentCreateFormSchema.safeParse({ ...valid, amount: '10.123' }).success).toBe(false);
    expect(adjustmentCreateFormSchema.safeParse({ ...valid, payrollMonth: '2026-13' }).success).toBe(false);
    expect(adjustmentCreateFormSchema.safeParse({ ...valid, payrollMonth: '' }).success).toBe(false);
  });
});

describe('adjustmentUpdateFormSchema', () => {
  test('accepts amount and month without an employee', () => {
    expect(adjustmentUpdateFormSchema.parse({ amount: '99.90', payrollMonth: '2026-05' }))
      .toEqual({ amount: '99.90', payrollMonth: '2026-05' });
  });
});

describe('bonus adjustment form schemas', () => {
  test('require and trim a reason without changing deduction forms', () => {
    const create = { employeeId: '1', amount: '100', payrollMonth: '2026-06' };
    const update = { amount: '100', payrollMonth: '2026-06' };

    expect(bonusAdjustmentCreateFormSchema.safeParse(create).success).toBe(false);
    expect(bonusAdjustmentUpdateFormSchema.safeParse(update).success).toBe(false);
    expect(bonusAdjustmentCreateFormSchema.parse({ ...create, reason: '  أداء استثنائي  ' }))
      .toEqual({ employeeId: 1, amount: '100', payrollMonth: '2026-06', reason: 'أداء استثنائي' });
    expect(adjustmentCreateFormSchema.safeParse(create).success).toBe(true);
  });
});
