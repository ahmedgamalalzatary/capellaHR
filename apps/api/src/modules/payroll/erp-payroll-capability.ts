import {
  erpCommissionPayrollInputs,
  erpPostPayrollDeductions,
  payrollMonths,
} from '@capella/database/schema';
import { and, eq } from 'drizzle-orm';

import {
  type Database,
  lockEmployee,
  type Transaction,
} from './financial-repository-helpers.js';
import { calendarMonthInTimeZone, payrollMonthStart } from './payroll-domain.js';

type ErpPayrollCommissionInputBase = {
  employeeId: number;
  payrollMonth: string;
  reference: string;
};

export type ErpPayrollCommissionInput = ErpPayrollCommissionInputBase & (
  | { amount: string; calculateAmount?: never }
  | { amount?: never; calculateAmount: () => Promise<string> }
);

export type ErpPostPayrollDeductionInput = {
  employeeId: number;
  occurredAt: Date;
  amount: string;
  reference: string;
};

export type ErpCommissionProjectionResult =
  | 'recorded'
  | 'updated'
  | 'already_recorded'
  | 'payroll_finalized'
  | 'payroll_finalized_without_commission';

export interface ErpPayrollCapability {
  lockCommissionEmployee(employeeId: number, context: unknown): Promise<void>;
  projectCommission(
    input: ErpPayrollCommissionInput,
    context?: unknown,
  ): Promise<ErpCommissionProjectionResult>;
  recordPostPayrollDeduction(
    input: ErpPostPayrollDeductionInput,
    context?: unknown,
  ): Promise<'recorded' | 'already_recorded'>;
}

export class ErpPayrollCapabilityError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'IDEMPOTENCY_CONFLICT') {
    super(code);
    this.name = 'ErpPayrollCapabilityError';
  }
}

const moneyPattern = /^(?:0|[1-9]\d{0,11})\.\d{2}$/;
const monthPattern = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const assertCommissionInput = (input: ErpPayrollCommissionInput) => {
  if (!Number.isInteger(input.employeeId) || input.employeeId <= 0
    || !monthPattern.test(input.payrollMonth)
    || input.reference !== `erp-commission:${input.payrollMonth}:${input.employeeId}`) {
    throw new ErpPayrollCapabilityError('INVALID_INPUT');
  }
};
const assertDeductionInput = (input: ErpPostPayrollDeductionInput) => {
  if (!Number.isInteger(input.employeeId) || input.employeeId <= 0
    || Number.isNaN(input.occurredAt.getTime())
    || !moneyPattern.test(input.amount) || input.amount === '0.00'
    || !input.reference.startsWith('erp-commission-reversal:')) {
    throw new ErpPayrollCapabilityError('INVALID_INPUT');
  }
};

export const createErpPayrollCapability = (
  database: Database,
  options: { now?: () => Date; timeZone?: string } = {},
): ErpPayrollCapability => {
  const now = options.now ?? (() => new Date());
  const timeZone = options.timeZone ?? 'Africa/Cairo';
  const inTransaction = <T>(context: unknown, operation: (transaction: Transaction) => Promise<T>) => (
    context === undefined
      ? database.transaction(operation)
      : operation(context as Transaction)
  );

  return {
    async lockCommissionEmployee(employeeId, context) {
      if (!Number.isInteger(employeeId) || employeeId <= 0 || context === undefined) {
        throw new ErpPayrollCapabilityError('INVALID_INPUT');
      }
      if (!await lockEmployee(context as Transaction, employeeId)) {
        throw new ErpPayrollCapabilityError('INVALID_INPUT');
      }
    },

    async projectCommission(input, context) {
      assertCommissionInput(input);
      return await inTransaction(context, async (transaction) => {
        if (!await lockEmployee(transaction, input.employeeId)) {
          throw new ErpPayrollCapabilityError('INVALID_INPUT');
        }
        const finalized = (await transaction.select({
          commissionAmount: payrollMonths.commissionAmount,
        }).from(payrollMonths).where(and(
          eq(payrollMonths.employeeId, input.employeeId),
          eq(payrollMonths.payrollMonth, payrollMonthStart(input.payrollMonth)),
        )).limit(1))[0];
        if (finalized) {
          return finalized.commissionAmount === '0.00'
            ? 'payroll_finalized_without_commission'
            : 'payroll_finalized';
        }
        const amount = input.calculateAmount ? await input.calculateAmount() : input.amount;
        if (!moneyPattern.test(amount)) throw new ErpPayrollCapabilityError('INVALID_INPUT');
        const month = payrollMonthStart(input.payrollMonth);
        const existing = (await transaction.select().from(erpCommissionPayrollInputs).where(and(
          eq(erpCommissionPayrollInputs.employeeId, input.employeeId),
          eq(erpCommissionPayrollInputs.payrollMonth, month),
        )).limit(1))[0];
        if (!existing) {
          const at = now();
          await transaction.insert(erpCommissionPayrollInputs).values({
            employeeId: input.employeeId,
            payrollMonth: month,
            amount,
            reference: input.reference,
            createdAt: at,
            updatedAt: at,
          });
          return 'recorded';
        }
        if (existing.reference !== input.reference) {
          throw new ErpPayrollCapabilityError('IDEMPOTENCY_CONFLICT');
        }
        if (existing.amount === amount) return 'already_recorded';
        await transaction.update(erpCommissionPayrollInputs).set({
          amount,
          updatedAt: now(),
        }).where(eq(erpCommissionPayrollInputs.id, existing.id));
        return 'updated';
      });
    },

    async recordPostPayrollDeduction(input, context) {
      assertDeductionInput(input);
      return await inTransaction(context, async (transaction) => {
        if (!await lockEmployee(transaction, input.employeeId)) {
          throw new ErpPayrollCapabilityError('INVALID_INPUT');
        }
        const month = payrollMonthStart(calendarMonthInTimeZone(input.occurredAt, timeZone));
        const existing = (await transaction.select().from(erpPostPayrollDeductions)
          .where(eq(erpPostPayrollDeductions.reference, input.reference)).limit(1))[0];
        if (existing) {
          if (existing.employeeId !== input.employeeId
            || existing.payrollMonth !== month
            || existing.amount !== input.amount
            || existing.occurredAt.getTime() !== input.occurredAt.getTime()) {
            throw new ErpPayrollCapabilityError('IDEMPOTENCY_CONFLICT');
          }
          return 'already_recorded';
        }
        await transaction.insert(erpPostPayrollDeductions).values({
          employeeId: input.employeeId,
          payrollMonth: month,
          amount: input.amount,
          reference: input.reference,
          occurredAt: input.occurredAt,
          createdAt: now(),
        });
        return 'recorded';
      });
    },
  };
};
