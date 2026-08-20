import { containsArabicIndicDigits, normalizeEgyptianMobile } from '@capella/shared';
import { z } from 'zod';
import { coercedShiftDurationMinutesSchema } from '../shifts/index.js';
import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../common/index.js';

const phone = z.string().transform((value, context) => {
  if (containsArabicIndicDigits(value)) {
    context.addIssue({ code: 'custom', message: 'استخدم الأرقام الإنجليزية من 0 إلى 9' });
    return z.NEVER;
  }
  const normalized = normalizeEgyptianMobile(value);
  if (!normalized) { context.addIssue({ code: 'custom', message: 'رقم الهاتف المصري غير صالح' }); return z.NEVER; }
  return normalized;
});
const money = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/).refine((value) => !/^0+(?:\.0{1,2})?$/.test(value)).transform((value) => {
  const [whole, fraction = ''] = value.split('.'); return `${whole!.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
});
export const createEmployeeFieldsSchema = z.object({
  fullName: z.string().trim().min(1).max(255), personalPhone: phone, whatsappPhone: phone, pin: z.string().regex(/^\d{4}$/),
  age: coercedMysqlIntSchema, address: z.string().trim().min(1).max(1000),
  branchId: coercedMysqlIntSchema, shiftDurationMinutes: coercedShiftDurationMinutesSchema, monthlyBaseSalary: money,
}).strict();
export const updateEmployeeFieldsSchema = createEmployeeFieldsSchema.omit({ monthlyBaseSalary: true }).partial().strict().refine((value) => Object.keys(value).length > 0);
export const employeeIdParamsSchema = z.object({ id: coercedMysqlIntSchema });
export const employeeDebtParamsSchema = employeeIdParamsSchema.extend({ debtId: coercedMysqlIntSchema });
export const employeeImageParamsSchema = employeeIdParamsSchema.extend({ kind: z.enum(['personal', 'idFront', 'idBack']) });
export const listEmployeesQuerySchema = z.object({ search: z.string().trim().min(1).max(255).optional(), branchId: coercedMysqlIntSchema.optional(), status: z.enum(['active', 'inactive', 'all']).optional(), page: paginationPageSchema.default(1), pageSize: paginationPageSizeSchema.default(20) });
/**
 * What to do with the advances an employee still owes when they are deactivated.
 * - `sum_all` collapses the remaining installments onto the current month and deducts them,
 *   which may leave a shortfall for {@link employeeNegativeBalanceDecisions} to resolve.
 * - `zero_salary` settles the debt against the salary so neither side owes anything.
 * - `ignore_debt` writes the debt off and pays the salary untouched.
 */
export const employeeAdvanceDecisions = ['sum_all', 'zero_salary', 'ignore_debt'] as const;
/** How to resolve a shortfall that remains after `sum_all`. */
export const employeeNegativeBalanceDecisions = ['collect_cash', 'record_debt'] as const;

/** Rejects the impossible dates a bare regex lets through, such as 2026-02-31. */
const calendarDateSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, 'التاريخ غير صالح');

export const employeeDeactivationSchema = z.object({
  // Why they left and the day they last worked: the two facts the settlement statement needs
  // that nothing in payroll can infer.
  reason: z.string().trim().min(1).max(500),
  lastWorkingDay: calendarDateSchema,
  advanceDecision: z.enum(employeeAdvanceDecisions),
  // Only `sum_all` can leave a shortfall; the other decisions settle the balance themselves.
  negativeBalanceDecision: z.enum(employeeNegativeBalanceDecisions).optional(),
  expectedUnpaidInstallmentCount: z.number().int().nonnegative(),
  expectedUnpaidAdvanceAmount: z.string().regex(/^\d{1,12}\.\d{2}$/),
  expectedProjectedNetSalary: z.string().regex(/^-?\d{1,12}\.\d{2}$/),
  expectedAmountOwed: z.string().regex(/^\d{1,12}\.\d{2}$/),
}).strict();
export type CreateEmployeeFields = z.infer<typeof createEmployeeFieldsSchema>;
export type UpdateEmployeeFields = z.infer<typeof updateEmployeeFieldsSchema>;
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
export type EmployeeDeactivationInput = z.infer<typeof employeeDeactivationSchema>;
export type EmployeeDebtParams = z.infer<typeof employeeDebtParamsSchema>;
export type EmployeeAdvanceDecision = (typeof employeeAdvanceDecisions)[number];
export type EmployeeNegativeBalanceDecision = (typeof employeeNegativeBalanceDecisions)[number];

/**
 * Drives which confirmation the admin is shown: the advance decision is only offered when
 * installments are outstanding, and `canZeroSalary` gates the option that would otherwise
 * forfeit money the employee is genuinely owed.
 */
export type EmployeeDeactivationPreview = {
  unpaidInstallmentCount: number;
  unpaidAdvanceAmount: string;
  currentNetSalary: string;
  projectedNetSalary: string;
  amountOwed: string;
  canZeroSalary: boolean;
  hasOpenSession: boolean;
};
