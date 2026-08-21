import { describe, expect, it, vi } from 'vitest';

import {
  createEmployeeFinancialLifecycle,
  projectDeactivationBalance,
} from '../../src/modules/employees/deactivation-financial.js';
import { PayrollError } from '../../src/modules/payroll/index.js';
import type { EmployeeSettlementFigures } from '../../src/modules/employees/employees-service.js';

const at = new Date('2026-07-16T10:00:00.000Z');
const context = { tx: true };
const impact = {
  unpaidInstallmentCount: 3,
  unpaidAdvanceAmount: '1500.00',
  currentMonthAdvanceAmount: '500.00',
};

const cents = (amount: string) => Math.round(Number(amount) * 100);
const money = (value: number) => {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
};

/**
 * Ahmed's scenario by default: 2000 salary with this month's 500 installment already deducted,
 * 3000 still outstanding. Accelerating the remaining 2500 leaves him 500 short. Recorded
 * adjustments feed back into later previews the way the real payroll does, which is what makes
 * the settle-to-zero assertions meaningful.
 */
const lifecycleWith = (options: {
  netAfterAcceleration?: string;
  currentNetSalary?: string;
  unpaidAdvanceAmount?: string;
  currentMonthAdvanceAmount?: string;
  preview?: () => Promise<{ netSalary: string }>;
  previewInContext?: () => Promise<unknown>;
  isFinalized?: () => Promise<boolean>;
} = {}) => {
  const adjustments: { reason: string; amount: string }[] = [];
  const debts: { amount: string }[] = [];
  const accelerate = vi.fn(async () => undefined);
  const baseline = cents(options.netAfterAcceleration ?? '-500.00');
  const settled = () => baseline + adjustments.reduce((total, row) => total + cents(row.amount), 0);
  return {
    adjustments,
    debts,
    accelerate,
    lifecycle: createEmployeeFinancialLifecycle({
      timeZone: 'Africa/Cairo',
      now: () => at,
      attendance: {} as never,
      advances: {
        prepareEmployeeDeletion: vi.fn(async () => undefined),
        deactivationImpact: vi.fn(async () => ({
          ...impact,
          unpaidAdvanceAmount: options.unpaidAdvanceAmount ?? '3000.00',
          currentMonthAdvanceAmount: options.currentMonthAdvanceAmount ?? impact.currentMonthAdvanceAmount,
        })),
        accelerateForDeletion: accelerate,
      },
      settlements: {
        recordAdjustment: vi.fn(async (_id: number, _at: Date, reason: string, amount: string) => {
          adjustments.push({ reason, amount });
        }),
        recordOutstandingDebt: vi.fn(async (_id: number, _at: Date, amount: string) => {
          debts.push({ amount });
        }),
      },
      payroll: {
        preview: options.preview ?? (async () => ({ netSalary: options.currentNetSalary ?? '2000.00' })),
        previewInContext: options.previewInContext
          ?? (async () => ({ kind: 'success', payroll: { netSalary: money(settled()) } })),
        isFinalized: options.isFinalized ?? (async () => false),
      } as never,
    }),
  };
};

const lifecycle = (overrides: Parameters<typeof lifecycleWith>[0] = {}) => lifecycleWith(overrides).lifecycle;

const decide = (overrides: Record<string, unknown> = {}) => ({
  advanceDecision: 'sum_all',
  expectedUnpaidInstallmentCount: 3,
  expectedUnpaidAdvanceAmount: '3000.00',
  expectedProjectedNetSalary: '-500.00',
  expectedAmountOwed: '500.00',
  ...overrides,
} as never);

describe('employee deactivation financial projection', () => {
  it('replaces future installments with the combined amount in the current payroll', () => {
    expect(projectDeactivationBalance('1000.00', '1500.00', '500.00')).toEqual({
      projectedNetSalary: '0.00',
      amountOwed: '0.00',
    });
    expect(projectDeactivationBalance('500.00', '1500.00', '500.00')).toEqual({
      projectedNetSalary: '-500.00',
      amountOwed: '500.00',
    });
  });

  it('does not double-count an installment already included in current payroll', () => {
    expect(projectDeactivationBalance('2500.00', '500.00', '500.00')).toEqual({
      projectedNetSalary: '2500.00',
      amountOwed: '0.00',
    });
  });
});

describe('employee financial lifecycle error mapping', () => {
  it('previews the projected balance from payroll and unpaid advances', async () => {
    // 2000 salary, 3000 outstanding of which 500 is already in this month's payroll.
    await expect(lifecycle().previewEmployeeDeactivation(1)).resolves.toEqual({
      unpaidInstallmentCount: 3,
      unpaidAdvanceAmount: '3000.00',
      currentNetSalary: '2000.00',
      projectedNetSalary: '-500.00',
      amountOwed: '500.00',
      canZeroSalary: true,
    });
  });

  it('withholds the zero-salary option when the debt is smaller than the salary', async () => {
    const subject = lifecycle({ currentNetSalary: '2000.00', unpaidAdvanceAmount: '500.00' });

    await expect(subject.previewEmployeeDeactivation(1))
      .resolves.toMatchObject({ canZeroSalary: false });
  });

  it('reports blocked payroll as a client error instead of leaking a 500', async () => {
    const blocked = lifecycle({
      preview: () => Promise.reject(new PayrollError(
        'PAYROLL_BLOCKED',
        'تعذر حساب الراتب',
        ['ATTENDANCE_RECONCILIATION_PENDING'],
      )),
    });

    await expect(blocked.previewEmployeeDeactivation(1))
      .rejects.toMatchObject({ code: 'EMPLOYEE_PAYROLL_BLOCKED' });
  });

  it('rejects a preview once the current month is already finalized', async () => {
    const finalized = lifecycle({ isFinalized: async () => true });

    await expect(finalized.previewEmployeeDeactivation(1))
      .rejects.toMatchObject({ code: 'EMPLOYEE_PAYROLL_FINALIZED' });
  });

  it('reports blocked payroll during the deactivation transaction as a client error', async () => {
    const blocked = lifecycle({
      previewInContext: async () => ({ kind: 'blocked', reasons: ['OPEN_SESSION'] }),
    });

    await expect(blocked.prepareEmployeeDeactivation(1, at, decide(), context))
      .rejects.toMatchObject({ code: 'EMPLOYEE_PAYROLL_BLOCKED' });
  });
});

describe('deactivation decision tree', () => {
  it('sums the advances and leaves a settled balance alone', async () => {
    const { lifecycle: subject, adjustments, debts, accelerate } = lifecycleWith({
      netAfterAcceleration: '500.00',
    });

    await subject.prepareEmployeeDeactivation(1, at, decide({
      expectedProjectedNetSalary: '500.00', expectedAmountOwed: '0.00',
    }), context);

    expect(accelerate).toHaveBeenCalledWith(1, at, context);
    expect(adjustments).toEqual([]);
    expect(debts).toEqual([]);
  });

  it('credits a cash payment so the shortfall settles to zero', async () => {
    const { lifecycle: subject, adjustments, debts } = lifecycleWith();

    await subject.prepareEmployeeDeactivation(1, at, decide({
      negativeBalanceDecision: 'collect_cash',
    }), context);

    expect(adjustments).toEqual([{ reason: 'cash_payment', amount: '500.00' }]);
    expect(debts).toEqual([]);
  });

  it('records an outstanding debt and leaves the net salary negative', async () => {
    const { lifecycle: subject, adjustments, debts } = lifecycleWith();

    await subject.prepareEmployeeDeactivation(1, at, decide({
      negativeBalanceDecision: 'record_debt',
    }), context);

    // The negative net is the accounting record; the debt row is what outlives employment.
    expect(adjustments).toEqual([]);
    expect(debts).toEqual([{ amount: '500.00' }]);
  });

  it('refuses to sum advances into a shortfall without a decision on it', async () => {
    const { lifecycle: subject } = lifecycleWith();

    await expect(subject.prepareEmployeeDeactivation(1, at, decide(), context))
      .rejects.toMatchObject({ code: 'EMPLOYEE_NEGATIVE_BALANCE_DECISION_REQUIRED' });
  });

  it('writes off the shortfall when the salary is settled against the debt', async () => {
    const { lifecycle: subject, adjustments, debts } = lifecycleWith();

    await subject.prepareEmployeeDeactivation(1, at, decide({
      advanceDecision: 'zero_salary',
    }), context);

    expect(adjustments).toEqual([{ reason: 'write_off', amount: '500.00' }]);
    expect(debts).toEqual([]);
  });

  it('forfeits a positive remainder so zeroing the salary lands on exactly zero', async () => {
    const { lifecycle: subject, adjustments } = lifecycleWith({
      netAfterAcceleration: '400.00',
      currentNetSalary: '2000.00',
      unpaidAdvanceAmount: '3000.00',
    });

    await subject.prepareEmployeeDeactivation(1, at, decide({
      advanceDecision: 'zero_salary',
      expectedProjectedNetSalary: '400.00',
      expectedAmountOwed: '0.00',
    }), context);

    expect(adjustments).toEqual([{ reason: 'forfeited_salary', amount: '-400.00' }]);
  });

  it('refuses to zero a salary that exceeds the debt', async () => {
    // Offering this when the employee owes less than he earned would quietly forfeit the
    // difference, so the server rejects it even if the client somehow sends it.
    const { lifecycle: subject } = lifecycleWith({
      currentNetSalary: '2000.00',
      unpaidAdvanceAmount: '500.00',
      netAfterAcceleration: '1500.00',
    });

    await expect(subject.prepareEmployeeDeactivation(1, at, decide({
      advanceDecision: 'zero_salary',
      expectedUnpaidAdvanceAmount: '500.00',
      expectedProjectedNetSalary: '1500.00',
      expectedAmountOwed: '0.00',
    }), context)).rejects.toMatchObject({ code: 'EMPLOYEE_ZERO_SALARY_NOT_ALLOWED' });
  });

  it('records nothing when there is no advance debt to forgive', async () => {
    // Nobody owes anything, so "forgive the debt" has nothing to forgive. A 0.00 write-off
    // would be a meaningless row in the books.
    const { lifecycle: subject, adjustments, debts } = lifecycleWith({
      unpaidAdvanceAmount: '0.00',
      currentMonthAdvanceAmount: '0.00',
      netAfterAcceleration: '2000.00',
    });

    await subject.prepareEmployeeDeactivation(1, at, decide({
      advanceDecision: 'ignore_debt',
      expectedUnpaidAdvanceAmount: '0.00',
      expectedProjectedNetSalary: '2000.00',
      expectedAmountOwed: '0.00',
    }), context);

    expect(adjustments).toEqual([]);
    expect(debts).toEqual([]);
  });

  it('writes off the whole debt so an ignored balance pays the full salary', async () => {
    const { lifecycle: subject, adjustments, debts } = lifecycleWith();

    await subject.prepareEmployeeDeactivation(1, at, decide({
      advanceDecision: 'ignore_debt',
    }), context);

    // The accelerated 3000 is still charged, and the offsetting write-off restores the salary.
    expect(adjustments).toEqual([{ reason: 'write_off', amount: '3000.00' }]);
    expect(debts).toEqual([]);
  });
});

describe('deactivation settlement figures', () => {
  it('reports what the settlement did when the shortfall becomes a debt', async () => {
    // 2000 earned before deactivation decision, 2500 of advances accelerated, leaving 500 short.
    await expect(lifecycle().prepareEmployeeDeactivation(1, at, decide({
      negativeBalanceDecision: 'record_debt',
    }), context)).resolves.toEqual({
      netSalaryBeforeSettlement: '2000.00',
      advancesRecovered: '2500.00',
      writeOffAmount: '0.00',
      forfeitedSalaryAmount: '0.00',
      cashCollectedAmount: '0.00',
      debtRecordedAmount: '500.00',
      finalNetSalary: '-500.00',
    });
  });

  it('reports the write-off when the advance debt is forgiven', async () => {
    await expect(lifecycle().prepareEmployeeDeactivation(1, at, decide({
      advanceDecision: 'ignore_debt',
    }), context)).resolves.toMatchObject({
      netSalaryBeforeSettlement: '2000.00',
      advancesRecovered: '2500.00',
      writeOffAmount: '3000.00',
      debtRecordedAmount: '0.00',
      // Forgiving all 3000 hands back this month's own installment too, so he clears 2500.
      finalNetSalary: '2500.00',
    });
  });

  it('reports the cash collected when the shortfall is paid at the counter', async () => {
    await expect(lifecycle().prepareEmployeeDeactivation(1, at, decide({
      negativeBalanceDecision: 'collect_cash',
    }), context)).resolves.toMatchObject({
      cashCollectedAmount: '500.00',
      finalNetSalary: '0.00',
    });
  });

  it('settlement statement arithmetic reconciles across all decision branches', async () => {
    // Every line the printed statement shows must add up to the salary it settled at:
    //   netBefore - advancesRecovered + writeOff - forfeited + cashCollected === finalNetSalary
    // debtRecorded is not in the identity: it is a separate row that outlives employment, not a
    // payroll adjustment, so the month keeps its negative net as the record of the shortfall.
    const check = (statement: EmployeeSettlementFigures, label: string) => {
      const value = (amount: string) => Math.round(parseFloat(amount) * 100);
      const computed = value(statement.netSalaryBeforeSettlement)
        - value(statement.advancesRecovered)
        + value(statement.writeOffAmount)
        - value(statement.forfeitedSalaryAmount)
        + value(statement.cashCollectedAmount);
      expect({ label, computed }).toEqual({ label, computed: value(statement.finalNetSalary) });
      if (value(statement.debtRecordedAmount) > 0) {
        expect({ label, debt: value(statement.debtRecordedAmount) })
          .toEqual({ label, debt: -value(statement.finalNetSalary) });
      }
    };

    check(await lifecycle().prepareEmployeeDeactivation(1, at, decide({
      negativeBalanceDecision: 'record_debt',
    }), context), 'record_debt');

    check(await lifecycle().prepareEmployeeDeactivation(1, at, decide({
      advanceDecision: 'ignore_debt',
    }), context), 'ignore_debt');

    check(await lifecycle().prepareEmployeeDeactivation(1, at, decide({
      negativeBalanceDecision: 'collect_cash',
    }), context), 'collect_cash');

    check(await lifecycle().prepareEmployeeDeactivation(1, at, decide({
      advanceDecision: 'zero_salary',
    }), context), 'zero_salary');
  });
});
