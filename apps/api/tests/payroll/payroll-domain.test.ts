import { describe, expect, it } from 'vitest';

import {
  addPayrollMonths,
  calculatePayroll,
  settleCommission,
  splitInstallments,
} from '../../src/modules/payroll/index.js';
import { bonusDaysAmount, fullMonthWorkdaysFor } from '../../src/modules/payroll/index.js';

describe('the workday count a day rate is priced against', () => {
  it('is the length of the month less each weekly day off taken in it', () => {
    // This is the same figure payroll prorates against, so a day bonus and the
    // prorated base can never be derived from two different months.
    expect(fullMonthWorkdaysFor({ payrollMonth: '2026-07', weeklyDaysOff: [] })).toBe(31);
    expect(fullMonthWorkdaysFor({ payrollMonth: '2026-02', weeklyDaysOff: [] })).toBe(28);
    expect(fullMonthWorkdaysFor({ payrollMonth: '2026-07', weeklyDaysOff: ['2026-07-04'] })).toBe(30);
    expect(fullMonthWorkdaysFor({
      payrollMonth: '2026-07', weeklyDaysOff: ['2026-07-04', '2026-07-11', '2026-07-18'],
    })).toBe(28);
  });

  it('counts a day off once even when it is recorded more than once', () => {
    expect(fullMonthWorkdaysFor({
      payrollMonth: '2026-07', weeklyDaysOff: ['2026-07-04', '2026-07-04'],
    })).toBe(30);
  });

  it('ignores days off outside the month being priced', () => {
    expect(fullMonthWorkdaysFor({
      payrollMonth: '2026-07', weeklyDaysOff: ['2026-06-30', '2026-08-01'],
    })).toBe(31);
  });

  it('leaves a month with more days off than days as a floor, not a negative', () => {
    // Payroll cannot prorate against a negative denominator, and a day rate cannot
    // be negative either, so an over-booked month is worth nothing rather than inverted.
    const everyDay = Array.from({ length: 31 }, (_, index) => `2026-07-${String(index + 1).padStart(2, '0')}`);
    expect(fullMonthWorkdaysFor({ payrollMonth: '2026-07', weeklyDaysOff: everyDay })).toBe(0);
  });
});

describe('day-based bonus and deduction amounts', () => {
  it('prices a day against the salary and that month\'s workday count', () => {
    // 6000 over 30 workdays is 200.00 a day, so a single day is exactly that.
    expect(bonusDaysAmount({ days: 1, baseSalary: '6000.00', fullMonthWorkdays: 30 })).toBe('200.00');
    expect(bonusDaysAmount({ days: 2, baseSalary: '6000.00', fullMonthWorkdays: 30 })).toBe('400.00');
    expect(bonusDaysAmount({ days: 5, baseSalary: '6000.00', fullMonthWorkdays: 30 })).toBe('1000.00');
  });

  it('prices half a month as fifteen days against the same rate', () => {
    expect(bonusDaysAmount({ days: 15, baseSalary: '6000.00', fullMonthWorkdays: 30 })).toBe('3000.00');
    // A short month raises the daily rate, so fifteen days is worth more than half a
    // thirty-day salary. This is the rule the business asked for, not an accident.
    expect(bonusDaysAmount({ days: 15, baseSalary: '6000.00', fullMonthWorkdays: 28 })).toBe('3214.29');
  });

  it('rounds the day amount in exact cents rather than through a float', () => {
    // 100.00 over 3 days is 33.33... a day; two days of it must not drift.
    expect(bonusDaysAmount({ days: 1, baseSalary: '100.00', fullMonthWorkdays: 3 })).toBe('33.33');
    expect(bonusDaysAmount({ days: 2, baseSalary: '100.00', fullMonthWorkdays: 3 })).toBe('66.67');
    expect(bonusDaysAmount({ days: 3, baseSalary: '100.00', fullMonthWorkdays: 3 })).toBe('100.00');
  });

  it('prices nothing rather than dividing by a month with no workdays', () => {
    expect(bonusDaysAmount({ days: 5, baseSalary: '6000.00', fullMonthWorkdays: 0 })).toBe('0.00');
  });

  it('prices zero days as nothing', () => {
    expect(bonusDaysAmount({ days: 0, baseSalary: '6000.00', fullMonthWorkdays: 30 })).toBe('0.00');
  });
});

describe('payroll exact arithmetic', () => {
  it('carries an overpaid commission forward without reducing base salary', () => {
    expect(settleCommission({ earned: '100.00', paid: '200.00', priorCarry: '0.00', reversals: '0.00' })).toEqual({
      payable: '0.00', paidApplied: '100.00', priorRecovery: '0.00', carry: '100.00',
    });
    expect(settleCommission({ earned: '250.00', paid: '50.00', priorCarry: '100.00', reversals: '0.00' })).toEqual({
      payable: '100.00', paidApplied: '50.00', priorRecovery: '100.00', carry: '0.00',
    });
  });
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

  it('applies a separately recorded deactivation adjustment to any negative source', () => {
    expect(calculatePayroll({
      baseSalary: '0.00', fullMonthWorkdays: 0, eligibleWorkdays: 0,
      requiredMinutes: 0, overtimeMinutes: 0, shortageMinutes: 0,
      bonuses: '0.00', deductions: '125.00', advances: '50.00',
      priorNegativeCarry: '-25.00', deactivationAdjustment: '200.00',
    }).netSalary).toBe('0.00');
  });

  it('adds live ERP commission and subtracts post-finalization commission deductions', () => {
    expect(calculatePayroll({
      baseSalary: '0.00', fullMonthWorkdays: 0, eligibleWorkdays: 0,
      requiredMinutes: 0, overtimeMinutes: 0, shortageMinutes: 0,
      bonuses: '100.00', commission: '250.00', deductions: '25.00',
      commissionDeductions: '40.00', advances: '10.00', priorNegativeCarry: '0.00',
    }).netSalary).toBe('275.00');
  });

  it('leaves only the unpaid commission in net when part was paid mid-month', () => {
    expect(calculatePayroll({
      baseSalary: '5000.00', fullMonthWorkdays: 30, eligibleWorkdays: 30,
      requiredMinutes: 9000, overtimeMinutes: 0, shortageMinutes: 0,
      bonuses: '0.00', commission: '1000.00', deductions: '0.00',
      commissionDeductions: '200.00', advances: '0.00', priorNegativeCarry: '0.00',
    })).toMatchObject({ netSalary: '5800.00' });
  });

  it('subtracts a negative deactivation adjustment when the salary is forfeited', () => {
    // `zero_salary` on an employee whose debt is smaller than the month's earnings lands here:
    // the adjustment has to be able to pull the net down to exactly zero, not only up.
    expect(calculatePayroll({
      baseSalary: '0.00', fullMonthWorkdays: 0, eligibleWorkdays: 0,
      requiredMinutes: 0, overtimeMinutes: 0, shortageMinutes: 0,
      bonuses: '500.00', deductions: '0.00', advances: '0.00',
      priorNegativeCarry: '0.00', deactivationAdjustment: '-500.00',
    }).netSalary).toBe('0.00');
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

  it('supports a twelve-month advance schedule and rejects thirteen months', () => {
    const schedule = splitInstallments('1200.00', 12, '2026-07');
    expect(schedule).toHaveLength(12);
    expect(schedule.at(-1)).toEqual({ ordinal: 12, payrollMonth: '2027-06', amount: '100.00' });
    expect(() => splitInstallments('1300.00', 13, '2026-07')).toThrow(RangeError);
  });

  it('rejects schedules with zero-value installments or out-of-range months', () => {
    expect(() => splitInstallments('0.01', 2, '2026-07')).toThrow(RangeError);
    expect(() => splitInstallments('10.00', 2, '9999-12')).toThrow(RangeError);
  });
});
