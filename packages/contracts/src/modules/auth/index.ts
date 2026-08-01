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

const codePoints = (value: string) => [...value].length;

export const cashierUsernameSchema = z.string().trim().min(1)
  .refine((username) => (
    codePoints(username) <= 255
    && codePoints(username.toLowerCase()) <= 255
  ), { message: 'Username is too long' })
  .transform((username) => username.toLowerCase());

export const cashierLoginSchema = z.object({
  username: cashierUsernameSchema,
  password: z.string().min(1).max(1024),
}).strict();

export const promoteCashierSchema = z.object({
  employeeId: positiveMysqlIntSchema,
  username: cashierUsernameSchema,
  password: z.string().min(1).max(1024),
}).strict();

export const listCashierAccountsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const cashierAccountStatusSchema = z.object({
  active: z.boolean(),
}).strict();

export const resetCashierPasswordSchema = z.object({
  password: z.string().min(1).max(1024),
}).strict();

export const publicCashierAccountSchema = z.object({
  id: positiveMysqlIntSchema,
  username: cashierUsernameSchema,
  role: z.literal('cashier'),
  employeeId: positiveMysqlIntSchema,
  branchId: positiveMysqlIntSchema,
  active: z.boolean(),
}).strict();

export const accountSessionActorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('admin') }).strict(),
  z.object({
    type: z.literal('cashier'),
    accountId: positiveMysqlIntSchema,
    employeeId: positiveMysqlIntSchema,
  }).strict(),
]);

export const accountSessionDataSchema = z.object({
  actor: accountSessionActorSchema,
}).strict();

export const authSessionDataSchema = z.object({
  actor: z.discriminatedUnion('type', [
    ...accountSessionActorSchema.options,
    z.object({ type: z.literal('employee') }).strict(),
  ]),
}).strict();

export const employeeLoginSchema = z.object({
  employeeCode: positiveMysqlIntSchema,
  pin: z.string().regex(/^\d{4}$/),
  personalPhone: employeeLoginPhoneSchema,
  installationMarker: z.string().min(16).max(4096),
}).strict();

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type CashierLoginInput = z.infer<typeof cashierLoginSchema>;
export type PromoteCashierInput = z.infer<typeof promoteCashierSchema>;
export type ListCashierAccountsInput = z.infer<typeof listCashierAccountsSchema>;
export type CashierAccountStatusInput = z.infer<typeof cashierAccountStatusSchema>;
export type ResetCashierPasswordInput = z.infer<typeof resetCashierPasswordSchema>;
export type PublicCashierAccount = z.infer<typeof publicCashierAccountSchema>;
export type AccountSessionActor = z.infer<typeof accountSessionActorSchema>;
export type AccountSessionData = z.infer<typeof accountSessionDataSchema>;
export type AuthSessionData = z.infer<typeof authSessionDataSchema>;
export type EmployeeLoginInput = z.infer<typeof employeeLoginSchema>;
