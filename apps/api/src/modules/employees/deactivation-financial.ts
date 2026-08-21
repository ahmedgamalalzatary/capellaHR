import {
  calendarMonthInTimeZone,
  PayrollError,
  type PayrollAttendanceGateway,
  type PayrollRepository,
  type PayrollService,
} from '../payroll/index.js';
import type { DeactivationAdjustmentReason } from '../advances/advances-service.js';
import { EmployeeError, type EmployeeDeactivationDecisions, type EmployeeSettlementFigures } from './employees-service.js';

const cents = (amount: string) => {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -value : value;
};

export const formatCents = (value: bigint) => {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};

export const projectDeactivationBalance = (
  currentNetSalary: string,
  unpaidAdvanceAmount: string,
  currentMonthAdvanceAmount: string,
) => {
  const projected = cents(currentNetSalary)
    - (cents(unpaidAdvanceAmount) - cents(currentMonthAdvanceAmount));
  return {
    projectedNetSalary: formatCents(projected),
    amountOwed: formatCents(projected < 0n ? -projected : 0n),
  };
};

export type EmployeeFinancialLifecycleDependencies = {
  timeZone: string;
  now: () => Date;
  attendance: PayrollAttendanceGateway;
  advances: {
    prepareEmployeeDeletion(employeeId: number, deletedAt: Date, context?: unknown): Promise<void>;
    deactivationImpact(employeeId: number, at: Date, context?: unknown): Promise<{
      unpaidInstallmentCount: number;
      unpaidAdvanceAmount: string;
      currentMonthAdvanceAmount: string;
    }>;
    accelerateForDeletion(employeeId: number, deletedAt: Date, context: unknown): Promise<void>;
  };
  settlements: {
    recordAdjustment(
      employeeId: number, at: Date, reason: DeactivationAdjustmentReason, amount: string,
      context: unknown,
    ): Promise<void>;
    recordOutstandingDebt(
      employeeId: number, at: Date, amount: string, context: unknown,
    ): Promise<void>;
  };
  payroll: {
    preview: PayrollService['preview'];
    previewInContext: PayrollRepository['previewInContext'];
    isFinalized: PayrollRepository['isFinalized'];
  };
};

const payrollBlocked = () => new EmployeeError(
  'EMPLOYEE_PAYROLL_BLOCKED',
  'تعذر حساب راتب الشهر الحالي، لذلك لا يمكن تعطيل الموظف الآن',
);
const payrollFinalized = () => new EmployeeError(
  'EMPLOYEE_PAYROLL_FINALIZED',
  'لا يمكن تعطيل الموظف بعد اعتماد راتب الشهر الحالي',
);
const previewChanged = () => new EmployeeError(
  'EMPLOYEE_DEACTIVATION_PREVIEW_CHANGED',
  'تغيرت بيانات المعاينة. راجع القيم وأكد مرة أخرى',
);
const negativeBalanceDecisionRequired = () => new EmployeeError(
  'EMPLOYEE_NEGATIVE_BALANCE_DECISION_REQUIRED',
  'يجب تحديد كيفية تسوية المبلغ المتبقي على الموظف',
);
const zeroSalaryNotAllowed = () => new EmployeeError(
  'EMPLOYEE_ZERO_SALARY_NOT_ALLOWED',
  'لا يمكن تصفير الراتب لأن المستحق للموظف أكبر من المديونية',
);

/**
 * Settling the salary against the debt is only offered when the debt is at least the salary.
 * Below that it would silently forfeit money the employee has genuinely earned.
 */
const canZeroSalary = (netSalary: string, unpaidAdvanceAmount: string) => (
  cents(unpaidAdvanceAmount) >= cents(netSalary)
);

// Payroll failures are ordinary operating conditions here (a pending reconciliation, an open
// session), so they must surface as employee-facing conflicts rather than escaping the
// employees router as unhandled 500s.
const asEmployeeError = (error: unknown): never => {
  if (error instanceof PayrollError) throw payrollBlocked();
  throw error;
};

export const createEmployeeFinancialLifecycle = (
  dependencies: EmployeeFinancialLifecycleDependencies,
) => {
  const { timeZone, now, attendance, advances, settlements, payroll } = dependencies;
  return {
    prepareEmployeeDeletion: (employeeId: number, deletedAt: Date, context?: unknown) => (
      advances.prepareEmployeeDeletion(employeeId, deletedAt, context)
    ),

    async previewEmployeeDeactivation(employeeId: number) {
      const at = now();
      const month = calendarMonthInTimeZone(at, timeZone);
      // Checked up front so the admin is told before walking the confirmation flow, not after.
      if (await payroll.isFinalized(employeeId, `${month}-01`)) throw payrollFinalized();
      const [impact, current] = await Promise.all([
        advances.deactivationImpact(employeeId, at),
        payroll.preview(employeeId, month).catch(asEmployeeError),
      ]);
      return {
        unpaidInstallmentCount: impact.unpaidInstallmentCount,
        unpaidAdvanceAmount: impact.unpaidAdvanceAmount,
        currentNetSalary: current.netSalary,
        ...projectDeactivationBalance(
          current.netSalary,
          impact.unpaidAdvanceAmount,
          impact.currentMonthAdvanceAmount,
        ),
        canZeroSalary: canZeroSalary(current.netSalary, impact.unpaidAdvanceAmount),
      };
    },

    async prepareEmployeeDeactivation(
      employeeId: number,
      at: Date,
      input: EmployeeDeactivationDecisions,
      context: unknown,
    ) {
      const month = calendarMonthInTimeZone(at, timeZone);
      if (await payroll.isFinalized(employeeId, `${month}-01`, context)) throw payrollFinalized();
      const impact = await advances.deactivationImpact(employeeId, at, context);
      if (input.expected && (
        impact.unpaidInstallmentCount !== input.expected.unpaidInstallmentCount
        || impact.unpaidAdvanceAmount !== input.expected.unpaidAdvanceAmount
      )) throw previewChanged();
      await advances.accelerateForDeletion(employeeId, at, context);
      const result = await payroll.previewInContext(employeeId, month, attendance, context);
      if (result.kind !== 'success') throw payrollBlocked();
      const projected = result.payroll.netSalary;
      const amountOwed = projected.startsWith('-') ? projected.slice(1) : '0.00';
      if (input.expected && (
        projected !== input.expected.projectedNetSalary
        || amountOwed !== input.expected.amountOwed
      )) throw previewChanged();

      const projectedCents = cents(projected);
      // Only the installments this deactivation pulled forward. The current month's own
      // installment was already deducted by ordinary payroll, so counting it here would
      // overstate both the salary and the recovery by that amount.
      const advancesAccelerated = cents(impact.unpaidAdvanceAmount)
        - cents(impact.currentMonthAdvanceAmount);
      const netBeforeSettlement = projectedCents + advancesAccelerated;
      const figures = {
        // The salary as it stood before the deactivation touched it, so the statement reconciles:
        // netBefore - advancesRecovered + writeOff - forfeited + cashCollected = finalNetSalary.
        netSalaryBeforeSettlement: formatCents(netBeforeSettlement),
        advancesRecovered: formatCents(advancesAccelerated),
        writeOffAmount: '0.00',
        forfeitedSalaryAmount: '0.00',
        cashCollectedAmount: '0.00',
        debtRecordedAmount: '0.00',
      };
      if (input.advanceDecision === 'ignore_debt') {
        // The accelerated installments stay charged; an equal write-off restores the salary, so
        // the books still show what was owed and what the company absorbed. Nothing owed means
        // nothing to forgive, and a zero row would say the company absorbed something.
        if (cents(impact.unpaidAdvanceAmount) > 0n) {
          await settlements.recordAdjustment(
            employeeId, at, 'write_off', impact.unpaidAdvanceAmount, context,
          );
          figures.writeOffAmount = impact.unpaidAdvanceAmount;
        }
      } else if (input.advanceDecision === 'zero_salary') {
        // Same salary figure the preview screen judged this on, so the server never refuses an
        // option the admin was just offered.
        if (!canZeroSalary(formatCents(netBeforeSettlement), impact.unpaidAdvanceAmount)) {
          throw zeroSalaryNotAllowed();
        }
        if (projectedCents < 0n) {
          await settlements.recordAdjustment(
            employeeId, at, 'write_off', formatCents(-projectedCents), context,
          );
          figures.writeOffAmount = formatCents(-projectedCents);
        } else if (projectedCents > 0n) {
          await settlements.recordAdjustment(
            employeeId, at, 'forfeited_salary', formatCents(-projectedCents), context,
          );
          figures.forfeitedSalaryAmount = formatCents(projectedCents);
        }
      } else if (projectedCents < 0n) {
        if (input.negativeBalanceDecision === undefined) throw negativeBalanceDecisionRequired();
        if (input.negativeBalanceDecision === 'collect_cash') {
          await settlements.recordAdjustment(
            employeeId, at, 'cash_payment', formatCents(-projectedCents), context,
          );
          figures.cashCollectedAmount = formatCents(-projectedCents);
        } else {
          // Deliberately not an adjustment: the month keeps its negative net as the record of
          // the shortfall, and the debt row is what survives the employee leaving.
          await settlements.recordOutstandingDebt(
            employeeId, at, formatCents(-projectedCents), context,
          );
          figures.debtRecordedAmount = formatCents(-projectedCents);
        }
      }

      const expectedFinal = input.advanceDecision === 'zero_salary'
        || (input.advanceDecision === 'sum_all' && input.negativeBalanceDecision === 'collect_cash' && projectedCents < 0n)
        ? '0.00'
        : null;
      // Read unconditionally now, because the frozen statement must carry the figure payroll
      // actually settled at rather than one re-derived from whichever branch was taken.
      const settled = await payroll.previewInContext(employeeId, month, attendance, context);
      if (settled.kind !== 'success') throw payrollBlocked();
      if (expectedFinal !== null && settled.payroll.netSalary !== expectedFinal) {
        throw new Error(`Deactivation settlement left ${settled.payroll.netSalary} instead of ${expectedFinal}`);
      }
      return { ...figures, finalNetSalary: settled.payroll.netSalary } satisfies EmployeeSettlementFigures;
    },
  };
};
