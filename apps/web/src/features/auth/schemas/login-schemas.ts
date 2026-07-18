import { adminLoginSchema } from '@capella/contracts';
import { containsArabicIndicDigits } from '@capella/shared';
import { z } from 'zod';

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

const employeeLoginPhoneSchema = z.string().transform((value, context) => {
  if (containsArabicIndicDigits(value)) {
    context.addIssue({ code: 'custom', message: 'استخدم الأرقام الإنجليزية من 0 إلى 9' });
    return z.NEVER;
  }
  return value;
}).pipe(
  z.string().regex(
    /^01(?:0|1|2|5)\d{8}$/,
    'رقم هاتف مصري غير صالح (11 رقمًا يبدأ بـ 010/011/012/015)',
  ),
);

export const employeeLoginFormSchema = z.object({
  employeeCode: z.coerce
    .number({ invalid_type_error: 'كود الموظف يجب أن يكون رقمًا' })
    .int('كود الموظف يجب أن يكون رقمًا صحيحًا')
    .positive('كود الموظف مطلوب'),
  pin: z.string().regex(/^\d{4}$/, 'الرقم السري مكوَّن من 4 أرقام'),
  personalPhone: employeeLoginPhoneSchema,
});

export type EmployeeLoginFormValues = z.infer<typeof employeeLoginFormSchema>;
