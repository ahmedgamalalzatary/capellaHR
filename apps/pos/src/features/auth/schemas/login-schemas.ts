import { adminLoginSchema, cashierLoginSchema } from '@capella/contracts';
import { z } from 'zod';

const codePoints = (value: string) => [...value].length;

/** Contract schema with Arabic messages layered on for form display. */
export const adminLoginFormSchema = adminLoginSchema.extend({
  email: z
    .string()
    .trim()
    .min(1, 'البريد الإلكتروني مطلوب')
    .email('بريد إلكتروني غير صالح'),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
});

export type AdminLoginFormValues = z.infer<typeof adminLoginFormSchema>;

/** Mirrors cashierLoginSchema's bounds (255-codepoint username cap, 1024-char password cap). */
export const cashierLoginFormSchema = cashierLoginSchema.extend({
  username: z
    .string()
    .trim()
    .min(1, 'اسم المستخدم مطلوب')
    .refine(
      (username) => codePoints(username) <= 255 && codePoints(username.toLowerCase()) <= 255,
      { message: 'اسم المستخدم طويل جدًا' },
    )
    .transform((username) => username.toLowerCase()),
  password: z.string().min(1, 'كلمة المرور مطلوبة').max(1024, 'كلمة المرور طويلة جدًا'),
});

export type CashierLoginFormValues = z.infer<typeof cashierLoginFormSchema>;
