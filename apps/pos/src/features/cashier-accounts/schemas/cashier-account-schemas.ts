import { promoteCashierSchema, resetCashierPasswordSchema } from '@capella/contracts';
import { z } from 'zod';

const codePoints = (value: string) => [...value].length;

/** Mirrors cashierUsernameSchema's 255-codepoint cap, layered with Arabic messages. */
const usernameFormSchema = z
  .string()
  .trim()
  .min(1, 'اسم المستخدم مطلوب')
  .refine(
    (username) => codePoints(username) <= 255 && codePoints(username.toLowerCase()) <= 255,
    { message: 'اسم المستخدم طويل جدًا' },
  )
  .transform((username) => username.toLowerCase());

/** Mirrors the contract password fields' 1024-character cap. */
const passwordFormSchema = z
  .string()
  .min(1, 'كلمة المرور مطلوبة')
  .max(1024, 'كلمة المرور طويلة جدًا');

/** Contract schema with Arabic messages layered on for form display. */
export const promoteCashierFormSchema = promoteCashierSchema.extend({
  employeeId: z.coerce
    .number({ invalid_type_error: 'يجب اختيار الموظف' })
    .int('يجب اختيار الموظف')
    .positive('يجب اختيار الموظف')
    .max(2147483647, 'يجب اختيار الموظف'),
  username: usernameFormSchema,
  password: passwordFormSchema,
});

export type PromoteCashierFormValues = z.infer<typeof promoteCashierFormSchema>;

export const resetCashierPasswordFormSchema = resetCashierPasswordSchema.extend({
  password: passwordFormSchema,
});

export type ResetCashierPasswordFormValues = z.infer<typeof resetCashierPasswordFormSchema>;
