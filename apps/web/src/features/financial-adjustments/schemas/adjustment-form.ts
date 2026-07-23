import { z } from 'zod';

import { FORM_MESSAGES } from '@/lib/validation/messages';

const employeeId = z.preprocess(
  (value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    return value === null ? undefined : value;
  },
  z.coerce.number({ message: 'اختر الموظف' }).int('اختر الموظف').positive('اختر الموظف'),
);

/** Positive EGP amount with at most two decimals, kept as a string for the API. */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'أدخل مبلغًا صالحًا بالجنيه')
  .refine((value) => Number(value) > 0, 'أدخل مبلغًا أكبر من صفر');

const payrollMonth = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, FORM_MESSAGES.required);

/** Client-side mirror of the contracts' bonus/deduction create schema. */
export const adjustmentCreateFormSchema = z.object({
  employeeId,
  amount,
  payrollMonth,
});

/** The employee is immutable after creation; only amount and month may change. */
export const adjustmentUpdateFormSchema = z.object({
  amount,
  payrollMonth,
});

const bonusReason = z
  .string()
  .trim()
  .min(1, 'أدخل سبب المكافأة')
  .max(500, 'يجب ألا يزيد سبب المكافأة عن 500 حرف');

export const bonusAdjustmentCreateFormSchema = adjustmentCreateFormSchema.extend({
  reason: bonusReason,
});

export const bonusAdjustmentUpdateFormSchema = adjustmentUpdateFormSchema.extend({
  reason: bonusReason,
});

export type AdjustmentCreateFormValues = z.infer<typeof adjustmentCreateFormSchema> & {
  reason?: string;
};
export type AdjustmentUpdateFormValues = z.infer<typeof adjustmentUpdateFormSchema> & {
  reason?: string;
};
