import { describe, expect, test } from 'vitest';

import { baseSalaryFormSchema } from '../src/features/payroll/schemas/base-salary-form';

describe('baseSalaryFormSchema', () => {
  test('accepts a positive two-decimal EGP amount and trims whitespace', () => {
    expect(baseSalaryFormSchema.parse({ amount: ' 6500.50 ' })).toEqual({ amount: '6500.50' });
    expect(baseSalaryFormSchema.parse({ amount: '7000' })).toEqual({ amount: '7000' });
  });

  test('rejects zero, negative-like, and malformed amounts', () => {
    for (const amount of ['0', '0.00', '-100', 'abc', '10.123', '']) {
      expect(baseSalaryFormSchema.safeParse({ amount }).success).toBe(false);
    }
  });
});
