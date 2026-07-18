import { describe, expect, it } from 'vitest';

import {
  addPayrollMonths,
  calculatePayroll,
  splitInstallments,
} from '../../src/modules/payroll/index.js';

describe('payroll exact arithmetic', () => {
  it('prorates and calculates every component using exact rational cents', () => {
    expect(calculatePayroll({
      baseSalary: '6000.00',
      fullMonthWorkdays: 30,
      eligibleWorkdays: 15,
      requiredMinutes: 9000,
      overtimeMinutes: 60,
      shortageMinutes: 30,
      bonuses: '100.00',
      deductions: '50.00',
      advances: '200.00',
      priorNegativeCarry: '-30.00',
    })).toEqual({
      proratedBase: '3000.00',
      overtimeAmount: '20.00',
      attendanceDeductionAmount: '10.00',
      netSalary: '2830.00',
    });
  });

  it('avoids division by zero while retaining external financial effects', () => {
    expect(calculatePayroll({
      baseSalary: '6000.00', fullMonthWorkdays: 0, eligibleWorkdays: 0,
      requiredMinutes: 0, overtimeMinutes: 0, shortageMinutes: 0,
      bonuses: '100.00', deductions: '25.00', advances: '50.00', priorNegativeCarry: '-10.00',
    })).toMatchObject({ proratedBase: '0.00', netSalary: '15.00' });
  });

  it('does not double-round the prorated base before overtime and shortage', () => {
    expect(calculatePayroll({
      baseSalary: '100.00', fullMonthWorkdays: 3, eligibleWorkdays: 1,
      requiredMinutes: 19, overtimeMinutes: 8, shortageMinutes: 8,
      bonuses: '0.00', deductions: '0.00', advances: '0.00', priorNegativeCarry: '0.00',
    })).toMatchObject({
      proratedBase: '33.33',
      overtimeAmount: '14.04',
      attendanceDeductionAmount: '14.04',
    });
  });

  it('puts the exact installment rounding remainder in the final month', () => {
    expect(splitInstallments('100.00', 3, '2026-11')).toEqual([
      { ordinal: 1, payrollMonth: '2026-11', amount: '33.33' },
      { ordinal: 2, payrollMonth: '2026-12', amount: '33.33' },
      { ordinal: 3, payrollMonth: '2027-01', amount: '33.34' },
    ]);
    expect(addPayrollMonths('2026-12', 1)).toBe('2027-01');
  });

  it('rejects schedules with zero-value installments or out-of-range months', () => {
    expect(() => splitInstallments('0.01', 2, '2026-07')).toThrow(RangeError);
    expect(() => splitInstallments('10.00', 2, '9999-12')).toThrow(RangeError);
  });
});
