import { describe, expect, expectTypeOf, test } from 'vitest';

import {
  adjustmentCreateFormSchema,
  adjustmentUpdateFormSchema,
  bonusAdjustmentCreateFormSchema,
  bonusAdjustmentUpdateFormSchema,
  deductionAdjustmentCreateFormSchema,
  deductionAdjustmentUpdateFormSchema,
  type AdjustmentUpdateFormValues,
} from '../src/features/financial-adjustments/schemas/adjustment-form';

test('preserves the price field types used by the adjustment forms', () => {
  expectTypeOf<AdjustmentUpdateFormValues['amount']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<AdjustmentUpdateFormValues['days']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<AdjustmentUpdateFormValues['payrollMonth']>().toEqualTypeOf<string>();
});

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

describe('a blank price field', () => {
  test('is recognised through whitespace rather than read as a malformed figure', () => {
    // A field the user never meant to fill in can still hold a stray space. That is
    // "not filled in", so the other price may stand on its own.
    const base = { employeeId: '1', payrollMonth: '2026-06' };
    expect(adjustmentCreateFormSchema.parse({ ...base, amount: ' ', days: '2' }))
      .toEqual({ employeeId: 1, amount: '', days: '2', payrollMonth: '2026-06' });
    expect(adjustmentCreateFormSchema.parse({ ...base, amount: '250', days: '   ' }))
      .toEqual({ employeeId: 1, amount: '250', days: '', payrollMonth: '2026-06' });
  });

  test('still rejects a real figure that is not a price', () => {
    const base = { employeeId: '1', payrollMonth: '2026-06' };
    expect(adjustmentCreateFormSchema.safeParse({ ...base, amount: '0', days: '' }).success).toBe(false);
    expect(adjustmentCreateFormSchema.safeParse({ ...base, amount: '10.123', days: '' }).success).toBe(false);
    expect(adjustmentCreateFormSchema.safeParse({ ...base, amount: 'abc', days: '2' }).success).toBe(false);
    expect(adjustmentCreateFormSchema.safeParse({ ...base, amount: '', days: '99' }).success).toBe(false);
  });

  test('still refuses a form with neither price filled in', () => {
    const base = { employeeId: '1', payrollMonth: '2026-06' };
    expect(adjustmentCreateFormSchema.safeParse({ ...base, amount: '', days: '' }).success).toBe(false);
    expect(adjustmentCreateFormSchema.safeParse({ ...base, amount: '  ', days: '  ' }).success).toBe(false);
  });
});

describe.each([
  ['create', adjustmentCreateFormSchema],
  ['update', adjustmentUpdateFormSchema],
  ['bonus create', bonusAdjustmentCreateFormSchema],
  ['bonus update', bonusAdjustmentUpdateFormSchema],
  ['deduction create', deductionAdjustmentCreateFormSchema],
  ['deduction update', deductionAdjustmentUpdateFormSchema],
] as const)('%s price validation', (_name, schema) => {
  const common = { employeeId: '1', payrollMonth: '2026-06', reason: 'سبب' };

  test.each([
    { amount: ' \t ', days: '2', expected: { amount: '', days: '2' } },
    { amount: '250', days: ' \t ', expected: { amount: '250', days: '' } },
  ])('treats whitespace as blank: $expected', ({ amount, days, expected }) => {
    expect(schema.parse({ ...common, amount, days })).toMatchObject(expected);
  });

  test.each([
    { amount: ' \t ', days: ' \t ' },
    { amount: '250', days: '2' },
  ])('requires exactly one price: %j', (price) => {
    expect(schema.safeParse({ ...common, ...price }).success).toBe(false);
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

describe('deduction adjustment form schemas', () => {
  test('require, trim, and limit the reason to 200 characters', () => {
    const create = { employeeId: '1', amount: '100', payrollMonth: '2026-06' };
    const update = { amount: '100', payrollMonth: '2026-06' };

    expect(deductionAdjustmentCreateFormSchema.safeParse(create).success).toBe(false);
    expect(deductionAdjustmentUpdateFormSchema.safeParse(update).success).toBe(false);
    expect(deductionAdjustmentCreateFormSchema.parse({ ...create, reason: '  Late arrival  ' }))
      .toEqual({ employeeId: 1, amount: '100', payrollMonth: '2026-06', reason: 'Late arrival' });
    expect(deductionAdjustmentUpdateFormSchema.safeParse({
      ...update, reason: 'x'.repeat(201),
    }).success).toBe(false);
  });
});
