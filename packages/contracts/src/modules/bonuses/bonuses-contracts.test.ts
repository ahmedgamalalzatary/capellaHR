import { describe, expect, it } from 'vitest';

import {
  bonusParamsSchema,
  createBonusSchema,
  listBonusesQuerySchema,
  updateBonusSchema,
} from './index.js';

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
});
