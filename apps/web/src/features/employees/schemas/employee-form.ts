import { containsArabicIndicDigits, normalizeEgyptianMobile } from '@capella/shared';
import { z } from 'zod';

import { FORM_MESSAGES } from '@/lib/validation/messages';

const requiredNumber = (message: string = FORM_MESSAGES.invalidNumber) =>
  z.preprocess(
    (value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
      }
      return value === null ? undefined : value;
    },
    z.coerce.number({ message }).finite(message),
  );

/** Egyptian mobile: accepts Western digits with spacing, dashes, or a +20 prefix. */
const egyptianPhone = z.string().transform((value, context) => {
  if (containsArabicIndicDigits(value)) {
    context.addIssue({ code: 'custom', message: 'استخدم الأرقام الإنجليزية من 0 إلى 9' });
    return z.NEVER;
  }
  const normalized = normalizeEgyptianMobile(value);
  if (!normalized) {
    context.addIssue({ code: 'custom', message: 'رقم الهاتف المصري غير صالح' });
    return z.NEVER;
  }
  return normalized;
});

const pin = z.string().regex(/^\d{4}$/, 'أدخل رقمًا سريًا من 4 أرقام');

/** Positive EGP amount with at most two decimals, kept as a string for the API. */
const salary = z
  .string()
  .trim()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'أدخل مبلغًا صالحًا بالجنيه')
  .refine((value) => Number(value) > 0, 'أدخل مبلغًا أكبر من صفر');

const imageFile = z
  .custom<File>((value) => value instanceof File, FORM_MESSAGES.required)
  .refine((file) => file.type.startsWith('image/'), 'اختر ملف صورة صالحًا');

const editableFields = {
  fullName: z.string().trim().min(1, FORM_MESSAGES.required)
    .refine((value) => [...value].length <= 255, 'الاسم طويل جدًا'),
  personalPhone: egyptianPhone,
  whatsappPhone: egyptianPhone,
  age: requiredNumber().pipe(z.number().int(FORM_MESSAGES.invalidNumber).positive(FORM_MESSAGES.invalidNumber)),
  address: z.string().trim().min(1, FORM_MESSAGES.required)
    .refine((value) => [...value].length <= 1000, 'العنوان طويل جدًا'),
  shiftDurationMinutes: requiredNumber('أدخل مدة الوردية بالدقائق').pipe(
    z.number().int('أدخل مدة الوردية بالدقائق'),
  ),
};

/**
 * Client-side mirror of the contracts' create/update employee schemas, with
 * Arabic messages, coercion for text inputs, and the three required images.
 */
export const employeeCreateFormSchema = z.object({
  ...editableFields,
  pin,
  branchId: requiredNumber('اختر الفرع').pipe(z.number().int('اختر الفرع').positive('اختر الفرع')),
  monthlyBaseSalary: salary,
  personal: imageFile,
  idFront: imageFile,
  idBack: imageFile,
});

/** Branch and salary are immutable after creation; pin and images are optional. */
export const employeeUpdateFormSchema = z.object({
  ...editableFields,
  pin: z.preprocess((value) => (value === '' || value === null ? undefined : value), pin.optional()),
  personal: imageFile.optional(),
  idFront: imageFile.optional(),
  idBack: imageFile.optional(),
});

export type EmployeeCreateFormValues = z.infer<typeof employeeCreateFormSchema>;
export type EmployeeUpdateFormValues = z.infer<typeof employeeUpdateFormSchema>;
