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
  attendanceDeductionAmount: decimal('attendance_deduction_amount', { precision: 14, scale: 2 }).notNull(),
  manualDeductionAmount: decimal('manual_deduction_amount', { precision: 14, scale: 2 }).notNull(),
  advanceAmount: decimal('advance_amount', { precision: 14, scale: 2 }).notNull(),
  priorNegativeCarry: decimal('prior_negative_carry', { precision: 14, scale: 2 }).notNull(),
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

export const bonuses = mysqlTable('bonuses', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  payrollMonth: date('payroll_month', { mode: 'string' }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  index('bonuses_employee_month_idx').on(table.employeeId, table.payrollMonth),
  check('bonuses_amount_positive', sql`${table.amount} > 0`),
  check('bonuses_month_first_day', sql`dayofmonth(${table.payrollMonth}) = 1`),
]);

export const deductions = mysqlTable('deductions', {
  id: int('id').autoincrement().primaryKey(),
  employeeId: int('employee_id').notNull().references(() => employees.id),
  payrollMonth: date('payroll_month', { mode: 'string' }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => [
  index('deductions_employee_month_idx').on(table.employeeId, table.payrollMonth),
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
  check('advances_installment_count_range', sql`${table.installmentCount} between 1 and 4`),
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
  check('advance_installments_amount_positive', sql`${table.amount} > 0`),
  check('advance_installments_ordinal_range', sql`${table.ordinal} between 1 and 4`),
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
