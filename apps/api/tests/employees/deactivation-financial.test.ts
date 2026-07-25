import { describe, expect, it, vi } from 'vitest';

import {
  createEmployeeFinancialLifecycle,
  projectDeactivationBalance,
} from '../../src/modules/employees/deactivation-financial.js';
import { PayrollError } from '../../src/modules/payroll/index.js';

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
 * Ahmed's scenario by default: 2000 salary, 3000 outstanding, so summing the advances leaves
 * him 1000 short. Recorded adjustments feed back into later previews the way the real payroll
 * does, which is what makes the settle-to-zero assertions meaningful.
 */
const lifecycleWith = (options: {
  netAfterAcceleration?: string;
  currentNetSalary?: string;
  unpaidAdvanceAmount?: string;
  preview?: () => Promise<{ netSalary: string }>;
  previewInContext?: () => Promise<unknown>;
  isFinalized?: () => Promise<boolean>;
} = {}) => {
  const adjustments: { reason: string; amount: string }[] = [];
  const debts: { amount: string }[] = [];
  const accelerate = vi.fn(async () => undefined);
  const baseline = cents(options.netAfterAcceleration ?? '-1000.00');
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
  expectedProjectedNetSalary: '-1000.00',
  expectedAmountOwed: '1000.00',
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

    expect(adjustments).toEqual([{ reason: 'cash_payment', amount: '1000.00' }]);
    expect(debts).toEqual([]);
  });

  it('records an outstanding debt and leaves the net salary negative', async () => {
    const { lifecycle: subject, adjustments, debts } = lifecycleWith();

    await subject.prepareEmployeeDeactivation(1, at, decide({
      negativeBalanceDecision: 'record_debt',
    }), context);

    // The negative net is the accounting record; the debt row is what outlives employment.
    expect(adjustments).toEqual([]);
    expect(debts).toEqual([{ amount: '1000.00' }]);
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

    expect(adjustments).toEqual([{ reason: 'write_off', amount: '1000.00' }]);
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
