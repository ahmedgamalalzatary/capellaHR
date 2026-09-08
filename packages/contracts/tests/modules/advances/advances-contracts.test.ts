import { describe, expect, it } from 'vitest';

import {
  advanceParamsSchema,
  createAdvanceSchema,
  listAdvancesQuerySchema,
  updateAdvanceSchema,
} from '../../../src/modules/advances/index.js';

describe('advance contracts', () => {
  it('parses one-to-twelve installment create and update inputs', () => {
    expect(createAdvanceSchema.parse({
      employeeId: 2,
      amount: '1000',
      installmentCount: 12,
      startMonth: '2026-07',
      reason: '  احتياج شخصي  ',
    })).toEqual({
      employeeId: 2, amount: '1000.00', installmentCount: 12,
      startMonth: '2026-07', reason: 'احتياج شخصي',
    });
    expect(updateAdvanceSchema.parse({ amount: '900.5', installmentCount: 3, reason: 'علاج' }))
      .toEqual({ amount: '900.50', installmentCount: 3, reason: 'علاج' });
    expect(advanceParamsSchema.parse({ advanceId: '5' })).toEqual({ advanceId: 5 });
    expect(listAdvancesQuerySchema.parse({ employeeId: '2', payrollMonth: '2026-08' }))
      .toEqual({ employeeId: 2, payrollMonth: '2026-08', page: 1, pageSize: 20 });
  });

  it('requires a non-empty advance reason of at most 200 characters', () => {
    const schedule = { employeeId: 2, amount: '100.00', installmentCount: 1, startMonth: '2026-07' };
    expect(createAdvanceSchema.safeParse(schedule).success).toBe(false);
    expect(createAdvanceSchema.safeParse({ ...schedule, reason: '   ' }).success).toBe(false);
    expect(createAdvanceSchema.safeParse({ ...schedule, reason: 'س'.repeat(201) }).success).toBe(false);
    expect(updateAdvanceSchema.safeParse({ reason: '   ' }).success).toBe(false);
  });

  it.each([0, 13, 1.5])('rejects installment count %s', (installmentCount) => {
    expect(() => createAdvanceSchema.parse({
      employeeId: 2, amount: '100.00', installmentCount, startMonth: '2026-07', reason: 'سبب',
    })).toThrow();
  });

  it('rejects empty updates and employee reassignment', () => {
    expect(() => updateAdvanceSchema.parse({})).toThrow();
    expect(() => updateAdvanceSchema.parse({ employeeId: 7 })).toThrow();
  });

  it('rejects schedules that cannot produce positive in-range installments', () => {
    expect(() => createAdvanceSchema.parse({
      employeeId: 2, amount: '0.01', installmentCount: 2, startMonth: '2026-07', reason: 'سبب',
    })).toThrow();
    expect(() => createAdvanceSchema.parse({
      employeeId: 2, amount: '10.00', installmentCount: 2, startMonth: '9999-12', reason: 'سبب',
    })).toThrow();
    expect(() => updateAdvanceSchema.parse({ amount: '0.01', installmentCount: 2 })).toThrow();
    expect(() => updateAdvanceSchema.parse({ installmentCount: 2, startMonth: '9999-12' })).toThrow();
  });
});
