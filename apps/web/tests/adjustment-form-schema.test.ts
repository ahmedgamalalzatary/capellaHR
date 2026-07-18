import { describe, expect, test } from 'vitest';

import {
  adjustmentCreateFormSchema,
  adjustmentUpdateFormSchema,
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
