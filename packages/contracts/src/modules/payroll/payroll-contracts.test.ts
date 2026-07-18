import { describe, expect, it } from 'vitest';

import {
  listPayrollMonthsQuerySchema,
  moneyAmountSchema,
  payrollBranchMonthParamsSchema,
  payrollEmployeeMonthParamsSchema,
  payrollMonthSchema,
  updateBaseSalarySchema,
} from './index.js';

describe('payroll contracts', () => {
  it('normalizes positive EGP amounts to exactly two decimals', () => {
    expect(moneyAmountSchema.parse('00042.5')).toBe('42.50');
    expect(moneyAmountSchema.parse('0.01')).toBe('0.01');
  });

  it.each(['0', '0.00', '-1.00', '1.001', '10000000000.00', 12])(
    'rejects invalid money input %s',
    (value) => expect(() => moneyAmountSchema.parse(value)).toThrow(),
  );

  it('returns readable Arabic validation messages', () => {
    const result = moneyAmountSchema.safeParse('0');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('المبلغ يجب أن يكون أكبر من صفر');
  });

  it('accepts only real YYYY-MM payroll months', () => {
    expect(payrollMonthSchema.parse('2026-07')).toBe('2026-07');
    for (const value of ['2026-00', '2026-13', '26-07', '2026-7']) {
      expect(() => payrollMonthSchema.parse(value)).toThrow();
    }
  });

  it('parses salary updates, month routes, and list filters strictly', () => {
    expect(updateBaseSalarySchema.parse({ amount: '5000' })).toEqual({ amount: '5000.00' });
    expect(payrollEmployeeMonthParamsSchema.parse({ employeeId: '7', month: '2026-07' }))
      .toEqual({ employeeId: 7, month: '2026-07' });
    expect(payrollBranchMonthParamsSchema.parse({ branchId: '3', month: '2026-07' }))
      .toEqual({ branchId: 3, month: '2026-07' });
    expect(listPayrollMonthsQuerySchema.parse({ branchId: '3', month: '2026-07' }))
      .toEqual({ branchId: 3, month: '2026-07', page: 1, pageSize: 20 });
    expect(() => updateBaseSalarySchema.parse({ amount: '1.00', extra: true })).toThrow();
  });
});
