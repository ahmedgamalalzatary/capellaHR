import { sql } from 'drizzle-orm';
import {
  check,
  date,
  decimal,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

import { employees } from '../employees/index.js';

const auditEntityTypes = ['salary', 'payroll', 'bonus', 'deduction', 'advance'] as const;
const auditActions = ['create', 'update', 'delete', 'finalize', 'accelerate'] as const;

export const employeeSalaryPeriods = mysqlTable('employee_salary_periods', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  effectiveMonth: date('effective_month', { mode: 'string' }).notNull(),
  baseSalary: decimal('base_salary', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('employee_salary_periods_employee_month_unique')
    .on(table.employeeId, table.effectiveMonth),
  check('employee_salary_periods_amount_positive', sql`${table.baseSalary} > 0`),
  check('employee_salary_periods_month_first_day', sql`dayofmonth(${table.effectiveMonth}) = 1`),
]);

export const payrollMonths = mysqlTable('payroll_months', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  payrollMonth: date('payroll_month', { mode: 'string' }).notNull(),
  status: mysqlEnum('status', ['finalized']).notNull().default('finalized'),
  baseSalary: decimal('base_salary', { precision: 12, scale: 2 }).notNull(),
  proratedBase: decimal('prorated_base', { precision: 14, scale: 2 }).notNull(),
  overtimeAmount: decimal('overtime_amount', { precision: 14, scale: 2 }).notNull(),
  bonusAmount: decimal('bonus_amount', { precision: 14, scale: 2 }).notNull(),
  commissionAmount: decimal('commission_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  attendanceDeductionAmount: decimal('attendance_deduction_amount', { precision: 14, scale: 2 }).notNull(),
  manualDeductionAmount: decimal('manual_deduction_amount', { precision: 14, scale: 2 }).notNull(),
  commissionDeductionAmount: decimal('commission_deduction_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  advanceAmount: decimal('advance_amount', { precision: 14, scale: 2 }).notNull(),
  priorNegativeCarry: decimal('prior_negative_carry', { precision: 14, scale: 2 }).notNull(),
  deactivationAdjustmentAmount: decimal('deactivation_adjustment_amount', { precision: 14, scale: 2 }).notNull().default('0.00'),
  netSalary: decimal('net_salary', { precision: 14, scale: 2 }).notNull(),
  eligibleWorkdays: int('eligible_workdays').notNull(),
  fullMonthWorkdays: int('full_month_workdays').notNull(),
  requiredMinutes: int('required_minutes').notNull(),
  overtimeMinutes: int('overtime_minutes').notNull(),
  shortageMinutes: int('shortage_minutes').notNull(),
  finalizedAt: timestamp('finalized_at', { mode: 'date', fsp: 3 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('payroll_months_employee_month_unique').on(table.employeeId, table.payrollMonth),
  index('payroll_months_month_status_idx').on(table.payrollMonth, table.status),
  check('payroll_months_month_first_day', sql`dayofmonth(${table.payrollMonth}) = 1`),
  check('payroll_months_counts_nonnegative', sql`${table.eligibleWorkdays} >= 0 and ${table.fullMonthWorkdays} >= 0 and ${table.requiredMinutes} >= 0 and ${table.overtimeMinutes} >= 0 and ${table.shortageMinutes} >= 0`),
]);

export const erpCommissionPayrollInputs = mysqlTable('erp_commission_payroll_inputs', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  payrollMonth: date('payroll_month', { mode: 'string' }).notNull(),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  reference: varchar('reference', { length: 191 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('erp_commission_payroll_inputs_reference_unique').on(table.reference),
  uniqueIndex('erp_commission_payroll_inputs_employee_month_unique')
    .on(table.employeeId, table.payrollMonth),
  check('erp_commission_payroll_inputs_amount_nonnegative', sql`${table.amount} >= 0`),
  check('erp_commission_payroll_inputs_month_first_day', sql`dayofmonth(${table.payrollMonth}) = 1`),
]);

export const erpPostPayrollDeductions = mysqlTable('erp_post_payroll_deductions', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  payrollMonth: date('payroll_month', { mode: 'string' }).notNull(),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  reference: varchar('reference', { length: 191 }).notNull(),
  occurredAt: timestamp('occurred_at', { mode: 'date', fsp: 3 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('erp_post_payroll_deductions_reference_unique').on(table.reference),
  index('erp_post_payroll_deductions_employee_month_idx').on(table.employeeId, table.payrollMonth),
  check('erp_post_payroll_deductions_amount_positive', sql`${table.amount} > 0`),
  check('erp_post_payroll_deductions_month_first_day', sql`dayofmonth(${table.payrollMonth}) = 1`),
]);

export const deactivationAdjustmentReasons = [
  'cash_payment',
  'write_off',
  'forfeited_salary',
] as const;

/**
 * Payroll-affecting corrections applied when an employee is deactivated mid-cycle. The amount is
 * signed: `cash_payment` and `write_off` credit the employee's net salary, while
 * `forfeited_salary` debits it, so the sum can be added to the net without branching on reason.
 */
export const employeeDeactivationAdjustments = mysqlTable('employee_deactivation_adjustments', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  payrollMonth: date('payroll_month', { mode: 'string' }).notNull(),
  reason: mysqlEnum('reason', deactivationAdjustmentReasons).notNull(),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('employee_deactivation_adjustments_employee_month_reason_unique')
    .on(table.employeeId, table.payrollMonth, table.reason),
  check('employee_deactivation_adjustments_amount_nonzero', sql`${table.amount} <> 0`),
  check('employee_deactivation_adjustments_month_first_day', sql`dayofmonth(${table.payrollMonth}) = 1`),
]);

/**
 * Money an employee still owes after deactivation. Deliberately outside payroll: the debt is a
 * receivable that outlives employment, and the month's negative net salary already records the
 * shortfall, so adding it to the net would cancel the very balance being tracked.
 */
export const employeeOutstandingDebts = mysqlTable('employee_outstanding_debts', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  payrollMonth: date('payroll_month', { mode: 'string' }).notNull(),
  amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  settledAt: timestamp('settled_at', { mode: 'date', fsp: 3 }),
}, (table) => [
  uniqueIndex('employee_outstanding_debts_employee_month_unique')
    .on(table.employeeId, table.payrollMonth),
  index('employee_outstanding_debts_settled_idx').on(table.employeeId, table.settledAt),
  check('employee_outstanding_debts_amount_positive', sql`${table.amount} > 0`),
  check('employee_outstanding_debts_month_first_day', sql`dayofmonth(${table.payrollMonth}) = 1`),
]);

/**
 * Why an employee left and what their settlement came to, captured at the moment of
 * deactivation. The figures are frozen deliberately: the statement handed to the employee must
 * reprint identically months later, when live payroll no longer reflects that month.
 *
 * Who terminated is stored as the audit actor rather than an account id, because the root admin
 * has no account row and a deactivation deferred to check-out is replayed by the system.
 *
 * Not unique per employee: a reactivated employee can be terminated again, and each departure
 * keeps its own record.
 */
export const employeeTerminations = mysqlTable('employee_terminations', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  reason: varchar('reason', { length: 500 }).notNull(),
  lastWorkingDay: date('last_working_day', { mode: 'string' }).notNull(),
  terminatedByType: mysqlEnum('terminated_by_type', ['admin', 'employee', 'account', 'system']).notNull(),
  terminatedByIdentifier: varchar('terminated_by_identifier', { length: 128 }).notNull(),
  netSalaryBeforeSettlement: decimal('net_salary_before_settlement', { precision: 14, scale: 2 }).notNull(),
  advancesRecovered: decimal('advances_recovered', { precision: 14, scale: 2 }).notNull(),
  writeOffAmount: decimal('write_off_amount', { precision: 14, scale: 2 }).notNull(),
  forfeitedSalaryAmount: decimal('forfeited_salary_amount', { precision: 14, scale: 2 }).notNull(),
  cashCollectedAmount: decimal('cash_collected_amount', { precision: 14, scale: 2 }).notNull(),
  debtRecordedAmount: decimal('debt_recorded_amount', { precision: 14, scale: 2 }).notNull(),
  finalNetSalary: decimal('final_net_salary', { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  index('employee_terminations_employee_idx').on(table.employeeId, table.createdAt),
  check('employee_terminations_write_off_nonnegative', sql`${table.writeOffAmount} >= 0`),
  check('employee_terminations_advances_nonnegative', sql`${table.advancesRecovered} >= 0`),
  check('employee_terminations_forfeited_nonnegative', sql`${table.forfeitedSalaryAmount} >= 0`),
  check('employee_terminations_cash_nonnegative', sql`${table.cashCollectedAmount} >= 0`),
  check('employee_terminations_debt_nonnegative', sql`${table.debtRecordedAmount} >= 0`),
  /**
   * A shortfall is either collected at the counter or left as a debt, never both. The
   * service picks one branch; this is the database refusing the impossible pair outright.
   */
  check(
    'employee_terminations_shortfall_single_outcome',
    sql`${table.cashCollectedAmount} = 0 or ${table.debtRecordedAmount} = 0`,
  ),
  /**
   * The printed statement has to add up. The recorded debt is deliberately outside the
   * identity: it is a row that outlives employment, not an adjustment to this month's pay.
   */
  check(
    'employee_terminations_statement_reconciles',
    sql`${table.netSalaryBeforeSettlement} - ${table.advancesRecovered} + ${table.writeOffAmount}
      - ${table.forfeitedSalaryAmount} + ${table.cashCollectedAmount} = ${table.finalNetSalary}`,
  ),
]);

export const pendingDeactivationAdvanceDecisions = [
  'sum_all',
  'zero_salary',
  'ignore_debt',
] as const;
export const pendingDeactivationNegativeDecisions = ['collect_cash', 'record_debt'] as const;

/**
 * A deactivation requested while the employee was still checked in. The admin's decisions are
 * captured up front and replayed when the session closes; the amounts are recomputed at that
 * point, because the closing shift can still change the month's totals.
 */
export const employeePendingDeactivations = mysqlTable('employee_pending_deactivations', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  advanceDecision: mysqlEnum('advance_decision', pendingDeactivationAdvanceDecisions).notNull(),
  negativeBalanceDecision: mysqlEnum('negative_balance_decision', pendingDeactivationNegativeDecisions),
  // Carried through to the replay so a deferred deactivation still produces a termination record.
  reason: varchar('reason', { length: 500 }).notNull(),
  lastWorkingDay: date('last_working_day', { mode: 'string' }).notNull(),
  requestedAt: timestamp('requested_at', { mode: 'date', fsp: 3 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('employee_pending_deactivations_employee_unique').on(table.employeeId),
]);

export const bonuses = mysqlTable('bonuses', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  payrollMonth: date('payroll_month', { mode: 'string' }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  reason: varchar('reason', { length: 500 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  index('bonuses_employee_month_idx').on(table.employeeId, table.payrollMonth),
  index('bonuses_month_employee_idx').on(table.payrollMonth, table.employeeId),
  check('bonuses_amount_positive', sql`${table.amount} > 0`),
  check('bonuses_month_first_day', sql`dayofmonth(${table.payrollMonth}) = 1`),
]);

export const deductions = mysqlTable('deductions', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  payrollMonth: date('payroll_month', { mode: 'string' }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  reason: varchar('reason', { length: 200 }),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  index('deductions_employee_month_idx').on(table.employeeId, table.payrollMonth),
  index('deductions_month_employee_idx').on(table.payrollMonth, table.employeeId),
  check('deductions_amount_positive', sql`${table.amount} > 0`),
  check('deductions_month_first_day', sql`dayofmonth(${table.payrollMonth}) = 1`),
]);

export const advances = mysqlTable('advances', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  installmentCount: int('installment_count').notNull(),
  startMonth: date('start_month', { mode: 'string' }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  uniqueIndex('advances_id_employee_unique').on(table.id, table.employeeId),
  index('advances_employee_idx').on(table.employeeId),
  check('advances_amount_positive', sql`${table.amount} > 0`),
  check('advances_installment_count_range', sql`${table.installmentCount} between 1 and 12`),
  check('advances_month_first_day', sql`dayofmonth(${table.startMonth}) = 1`),
]);

export const advanceInstallments = mysqlTable('advance_installments', {
  id: int('id').autoincrement().primaryKey(),
  advanceId: int('advance_id').notNull(),
  employeeId: int('employee_id').notNull(),
  ordinal: int('ordinal').notNull(),
  payrollMonth: date('payroll_month', { mode: 'string' }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  foreignKey({
    name: 'advance_installments_advance_employee_fk',
    columns: [table.advanceId, table.employeeId],
    foreignColumns: [advances.id, advances.employeeId],
  }),
  uniqueIndex('advance_installments_advance_ordinal_unique').on(table.advanceId, table.ordinal),
  uniqueIndex('advance_installments_advance_month_unique').on(table.advanceId, table.payrollMonth),
  index('advance_installments_employee_month_idx').on(table.employeeId, table.payrollMonth),
  index('advance_installments_month_employee_idx').on(table.payrollMonth, table.employeeId),
  check('advance_installments_amount_positive', sql`${table.amount} > 0`),
  check('advance_installments_ordinal_range', sql`${table.ordinal} between 1 and 12`),
  check('advance_installments_month_first_day', sql`dayofmonth(${table.payrollMonth}) = 1`),
]);

export const financialAuditEvents = mysqlTable('financial_audit_events', {
  id: int('id').autoincrement().primaryKey(),
  entityType: mysqlEnum('entity_type', auditEntityTypes).notNull(),
  entityId: int('entity_id').notNull(),
  action: mysqlEnum('action', auditActions).notNull(),
  beforeState: json('before_state'),
  afterState: json('after_state'),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [index('financial_audit_events_entity_idx').on(table.entityType, table.entityId)]);
