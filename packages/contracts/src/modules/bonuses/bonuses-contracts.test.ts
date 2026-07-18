import { describe, expect, it } from 'vitest';

import {
  bonusParamsSchema,
  createBonusSchema,
  listBonusesQuerySchema,
  updateBonusSchema,
} from './index.js';

describe('bonus contracts', () => {
  it('parses create, update, params, and list inputs', () => {
    expect(createBonusSchema.parse({ employeeId: 4, amount: '10', payrollMonth: '2026-07' }))
      .toEqual({ employeeId: 4, amount: '10.00', payrollMonth: '2026-07' });
    expect(updateBonusSchema.parse({ amount: '20.5' })).toEqual({ amount: '20.50' });
    expect(bonusParamsSchema.parse({ bonusId: '9' })).toEqual({ bonusId: 9 });
    expect(listBonusesQuerySchema.parse({ branchId: '2', employeeId: '4' }))
      .toEqual({ branchId: 2, employeeId: 4, page: 1, pageSize: 20 });
  });

  it('requires an update and rejects employee reassignment or descriptions', () => {
    expect(() => updateBonusSchema.parse({})).toThrow();
    expect(() => updateBonusSchema.parse({ employeeId: 7 })).toThrow();
    expect(() => createBonusSchema.parse({ employeeId: 4, amount: '10', payrollMonth: '2026-07', description: 'x' })).toThrow();
  });
});
