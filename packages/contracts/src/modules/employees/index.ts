import { normalizeEgyptianMobile } from '@capella/shared';
import { z } from 'zod';

const phone = z.string().transform((value, context) => {
  const normalized = normalizeEgyptianMobile(value);
  if (!normalized) { context.addIssue({ code: 'custom', message: 'رقم الهاتف المصري غير صالح' }); return z.NEVER; }
  return normalized;
});
const money = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/).refine((value) => !/^0+(?:\.0{1,2})?$/.test(value)).transform((value) => {
  const [whole, fraction = ''] = value.split('.'); return `${whole!.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
});
export const createEmployeeFieldsSchema = z.object({
  fullName: z.string().trim().min(1).max(255), personalPhone: phone, whatsappPhone: phone, pin: z.string().regex(/^\d{4}$/),
  age: z.coerce.number().int().positive().max(2147483647), address: z.string().trim().min(1).max(1000),
  branchId: z.coerce.number().int().positive().max(2147483647), shiftDurationMinutes: z.coerce.number().int().positive().max(720), monthlyBaseSalary: money,
}).strict();
export const updateEmployeeFieldsSchema = createEmployeeFieldsSchema.omit({ branchId: true, monthlyBaseSalary: true }).partial().strict().refine((value) => Object.keys(value).length > 0);
export const employeeIdParamsSchema = z.object({ id: z.coerce.number().int().positive().max(2147483647) });
export const employeeImageParamsSchema = employeeIdParamsSchema.extend({ kind: z.enum(['personal', 'idFront', 'idBack']) });
export const listEmployeesQuerySchema = z.object({ search: z.string().trim().min(1).max(255).optional(), branchId: z.coerce.number().int().positive().optional(), page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(100).default(20) });
export type CreateEmployeeFields = z.infer<typeof createEmployeeFieldsSchema>;
export type UpdateEmployeeFields = z.infer<typeof updateEmployeeFieldsSchema>;
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
