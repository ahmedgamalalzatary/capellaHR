import { describe, expect, it } from 'vitest';

import {
  bonusParamsSchema,
  createBonusSchema,
  listBonusesQuerySchema,
  updateBonusSchema,
} from '../../../src/modules/bonuses/index.js';

describe('bonus contracts', () => {
  it('parses create, update, params, and list inputs', () => {
    expect(createBonusSchema.parse({
      employeeId: 4, amount: '10', payrollMonth: '2026-07', reason: '  أداء استثنائي  ',
    })).toEqual({
      employeeId: 4, amount: '10.00', payrollMonth: '2026-07', reason: 'أداء استثنائي',
    });
    expect(updateBonusSchema.parse({ amount: '20.5', reason: 'تحقيق الهدف' }))
      .toEqual({ amount: '20.50', reason: 'تحقيق الهدف' });
    expect(bonusParamsSchema.parse({ bonusId: '9' })).toEqual({ bonusId: 9 });
    expect(listBonusesQuerySchema.parse({ branchId: '2', employeeId: '4' }))
      .toEqual({ branchId: 2, employeeId: 4, page: 1, pageSize: 20 });
  });

  it('requires a reason and rejects employee reassignment or descriptions', () => {
    expect(() => updateBonusSchema.parse({})).toThrow();
    expect(() => createBonusSchema.parse({ employeeId: 4, amount: '10', payrollMonth: '2026-07' })).toThrow();
    expect(() => createBonusSchema.parse({
      employeeId: 4, amount: '10', payrollMonth: '2026-07', reason: '   ',
    })).toThrow();
    expect(() => updateBonusSchema.parse({ amount: '20.5' })).toThrow();
    expect(() => updateBonusSchema.parse({ reason: 'x'.repeat(501) })).toThrow();
    expect(() => updateBonusSchema.parse({ employeeId: 7 })).toThrow();
    expect(() => createBonusSchema.parse({
      employeeId: 4, amount: '10', payrollMonth: '2026-07', reason: 'سبب', description: 'x',
    })).toThrow();
  });

  it('accepts a bonus priced by days instead of a typed amount', () => {
    expect(createBonusSchema.parse({
      employeeId: 4, days: 15, payrollMonth: '2026-07', reason: 'مكافأة نصف شهر',
    })).toEqual({
      employeeId: 4, days: 15, payrollMonth: '2026-07', reason: 'مكافأة نصف شهر',
    });
  });

  it('takes either days or an amount, never both and never neither', () => {
    // Both would leave the amount ambiguous: the typed figure or the priced one?
    expect(() => createBonusSchema.parse({
      employeeId: 4, amount: '10', days: 2, payrollMonth: '2026-07', reason: 'سبب',
    })).toThrow();
    expect(() => createBonusSchema.parse({
      employeeId: 4, payrollMonth: '2026-07', reason: 'سبب',
    })).toThrow();
  });

  it('rejects a day count that is not a positive whole number', () => {
    for (const days of [0, -1, 1.5, 'ثلاثة', null]) {
      expect(() => createBonusSchema.parse({
        employeeId: 4, days, payrollMonth: '2026-07', reason: 'سبب',
      })).toThrow();
    }
  });

  it('caps a day count at a full month of days', () => {
    // More than this is not a bonus for working, it is a mistake in the form.
    expect(() => createBonusSchema.parse({
      employeeId: 4, days: 32, payrollMonth: '2026-07', reason: 'سبب',
    })).toThrow();
  });
});
