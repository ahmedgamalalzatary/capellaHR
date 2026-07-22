import { containsArabicIndicDigits } from '@capella/shared';
import { z } from 'zod';
import { positiveMysqlIntSchema } from '../../common/index.js';

const employeeLoginPhoneSchema = z.string().transform((value, context) => {
  if (containsArabicIndicDigits(value)) {
    context.addIssue({ code: 'custom', message: 'استخدم الأرقام الإنجليزية من 0 إلى 9' });
    return z.NEVER;
  }
  return value;
}).pipe(z.string().regex(/^01(?:0|1|2|5)\d{8}$/));

export const adminLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
}).strict();

export const employeeLoginSchema = z.object({
  employeeCode: positiveMysqlIntSchema,
  pin: z.string().regex(/^\d{4}$/),
  personalPhone: employeeLoginPhoneSchema,
  installationMarker: z.string().min(16).max(4096),
}).strict();

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type EmployeeLoginInput = z.infer<typeof employeeLoginSchema>;
