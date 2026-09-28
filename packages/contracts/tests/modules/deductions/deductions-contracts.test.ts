import { describe, expect, it } from 'vitest';

import {
  createDeductionSchema,
  deductionParamsSchema,
  listDeductionsQuerySchema,
  updateDeductionSchema,
} from '../../../src/modules/deductions/index.js';

describe('deduction contracts', () => {
  it('mirrors positive fixed payroll adjustments without employee reassignment', () => {
    expect(createDeductionSchema.parse({
      employeeId: 4, amount: '10.1', payrollMonth: '2026-07', reason: '  Late arrival  ',
    })).toEqual({
      employeeId: 4, amount: '10.10', payrollMonth: '2026-07', reason: 'Late arrival',
    });
    expect(updateDeductionSchema.parse({ payrollMonth: '2026-06', reason: 'Policy violation' }))
      .toEqual({ payrollMonth: '2026-06', reason: 'Policy violation' });
    expect(deductionParamsSchema.parse({ deductionId: '8' })).toEqual({ deductionId: 8 });
    expect(listDeductionsQuerySchema.parse({ payrollMonth: '2026-07' }))
      .toEqual({ payrollMonth: '2026-07', page: 1, pageSize: 20 });
    expect(() => updateDeductionSchema.parse({ employeeId: 9 })).toThrow();
  });

  it('requires a reason of at most 200 characters on create and update', () => {
    const create = { employeeId: 4, amount: '10', payrollMonth: '2026-07' };
    expect(() => createDeductionSchema.parse(create)).toThrow();
    expect(() => createDeductionSchema.parse({ ...create, reason: '   ' })).toThrow();
    expect(() => updateDeductionSchema.parse({ amount: '20' })).toThrow();
    expect(() => updateDeductionSchema.parse({ reason: 'x'.repeat(201) })).toThrow();
    expect(updateDeductionSchema.parse({ reason: 'x'.repeat(200) }).reason).toHaveLength(200);
  });

  it('accepts a deduction priced by days instead of a typed amount', () => {
    expect(createDeductionSchema.parse({
      employeeId: 4, days: 2, payrollMonth: '2026-07', reason: 'خصم يومين',
    })).toEqual({
      employeeId: 4, days: 2, payrollMonth: '2026-07', reason: 'خصم يومين',
    });
  });

  it('takes either days or an amount, never both and never neither', () => {
    expect(() => createDeductionSchema.parse({
      employeeId: 4, amount: '10', days: 2, payrollMonth: '2026-07', reason: 'سبب',
    })).toThrow();
    expect(() => createDeductionSchema.parse({
      employeeId: 4, payrollMonth: '2026-07', reason: 'سبب',
    })).toThrow();
  });

  it('rejects a day count that is not a positive whole number within a month', () => {
    for (const days of [0, -1, 1.5, 'ثلاثة', 32]) {
      expect(() => createDeductionSchema.parse({
        employeeId: 4, days, payrollMonth: '2026-07', reason: 'سبب',
      })).toThrow();
    }
  });
});
