import { describe, expect, it } from 'vitest';

import {
  advanceParamsSchema,
  createAdvanceSchema,
  listAdvancesQuerySchema,
  updateAdvanceSchema,
} from './index.js';

describe('advance contracts', () => {
  it('parses one-to-twelve installment create and update inputs', () => {
    expect(createAdvanceSchema.parse({
      employeeId: 2,
      amount: '1000',
      installmentCount: 12,
      startMonth: '2026-07',
    })).toEqual({ employeeId: 2, amount: '1000.00', installmentCount: 12, startMonth: '2026-07' });
    expect(updateAdvanceSchema.parse({ amount: '900.5', installmentCount: 3 }))
      .toEqual({ amount: '900.50', installmentCount: 3 });
    expect(advanceParamsSchema.parse({ advanceId: '5' })).toEqual({ advanceId: 5 });
    expect(listAdvancesQuerySchema.parse({ employeeId: '2', payrollMonth: '2026-08' }))
      .toEqual({ employeeId: 2, payrollMonth: '2026-08', page: 1, pageSize: 20 });
  });

  it.each([0, 13, 1.5])('rejects installment count %s', (installmentCount) => {
    expect(() => createAdvanceSchema.parse({
      employeeId: 2, amount: '100.00', installmentCount, startMonth: '2026-07',
    })).toThrow();
  });

  it('rejects empty updates and employee reassignment', () => {
    expect(() => updateAdvanceSchema.parse({})).toThrow();
    expect(() => updateAdvanceSchema.parse({ employeeId: 7 })).toThrow();
  });

  it('rejects schedules that cannot produce positive in-range installments', () => {
    expect(() => createAdvanceSchema.parse({
      employeeId: 2, amount: '0.01', installmentCount: 2, startMonth: '2026-07',
    })).toThrow();
    expect(() => createAdvanceSchema.parse({
      employeeId: 2, amount: '10.00', installmentCount: 2, startMonth: '9999-12',
    })).toThrow();
    expect(() => updateAdvanceSchema.parse({ amount: '0.01', installmentCount: 2 })).toThrow();
    expect(() => updateAdvanceSchema.parse({ installmentCount: 2, startMonth: '9999-12' })).toThrow();
  });
});
