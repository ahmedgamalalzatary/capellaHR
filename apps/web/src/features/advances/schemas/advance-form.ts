import { z } from 'zod';

import { FORM_MESSAGES } from '@/lib/validation/messages';

const requiredNumber = (message: string) =>
  z.preprocess(
    (value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
      }
      return value === null ? undefined : value;
    },
    z.coerce.number({ message }).int(message),
  );

/** Positive EGP amount with at most two decimals, kept as a string for the API. */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'أدخل مبلغًا صالحًا بالجنيه')
  .refine((value) => Number(value) > 0, 'أدخل مبلغًا أكبر من صفر');

const installmentCount = requiredNumber('اختر عدد الأقساط').pipe(
  z.number().min(1, 'اختر عدد الأقساط').max(12, 'اختر عدد الأقساط'),
);

const startMonth = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, FORM_MESSAGES.required);

/** Every installment must stay a positive cent amount after equal division. */
const requirePositiveInstallments = (
  value: { amount: string; installmentCount: number },
  context: z.RefinementCtx,
) => {
  const [whole = '0', fraction = ''] = value.amount.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < value.installmentCount) {
    context.addIssue({
      code: 'custom',
      path: ['amount'],
      message: 'المبلغ لا يكفي لإنشاء أقساط موجبة',
    });
  }
};

export const advanceCreateFormSchema = z
  .object({
    employeeId: requiredNumber('اختر الموظف').pipe(z.number().positive('اختر الموظف')),
    amount,
    installmentCount,
    startMonth,
  })
  .superRefine(requirePositiveInstallments);

/** The employee is immutable after creation; the schedule may be regenerated. */
export const advanceUpdateFormSchema = z
  .object({ amount, installmentCount, startMonth })
  .superRefine(requirePositiveInstallments);

export type AdvanceCreateFormValues = z.infer<typeof advanceCreateFormSchema>;
export type AdvanceUpdateFormValues = z.infer<typeof advanceUpdateFormSchema>;
