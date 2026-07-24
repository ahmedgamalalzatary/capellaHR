import { describe, expect, test } from 'vitest';

import {
  advanceCreateFormSchema,
  advanceUpdateFormSchema,
} from '../src/features/advances/schemas/advance-form';

describe('advanceCreateFormSchema', () => {
  test('accepts employee, amount, installment count, and start month', () => {
    expect(
      advanceCreateFormSchema.parse({
        employeeId: '1',
        amount: ' 1200 ',
        installmentCount: '3',
        startMonth: '2026-08',
      }),
    ).toEqual({ employeeId: 1, amount: '1200', installmentCount: 3, startMonth: '2026-08' });
  });

  test('rejects out-of-range installment counts and bad amounts', () => {
    const valid = { employeeId: '1', amount: '1200', installmentCount: '2', startMonth: '2026-08' };
    expect(advanceCreateFormSchema.safeParse({ ...valid, installmentCount: '0' }).success).toBe(false);
    expect(advanceCreateFormSchema.safeParse({ ...valid, installmentCount: '12' }).success).toBe(true);
    expect(advanceCreateFormSchema.safeParse({ ...valid, installmentCount: '13' }).success).toBe(false);
    expect(advanceCreateFormSchema.safeParse({ ...valid, installmentCount: '' }).success).toBe(false);
    expect(advanceCreateFormSchema.safeParse({ ...valid, amount: '0' }).success).toBe(false);
    expect(advanceCreateFormSchema.safeParse({ ...valid, startMonth: '' }).success).toBe(false);
  });

  test('rejects an amount too small to produce positive installments', () => {
    expect(
      advanceCreateFormSchema.safeParse({
        employeeId: '1',
        amount: '0.02',
        installmentCount: '4',
        startMonth: '2026-08',
      }).success,
    ).toBe(false);
  });
});

describe('advanceUpdateFormSchema', () => {
  test('accepts the schedule fields without an employee', () => {
    expect(
      advanceUpdateFormSchema.parse({ amount: '900', installmentCount: '2', startMonth: '2026-09' }),
    ).toEqual({ amount: '900', installmentCount: 2, startMonth: '2026-09' });
  });
});
