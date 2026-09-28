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

/**
 * A day count, kept as a string by the input and validated here. The server prices it
 * against the employee's own day rate, so the form never computes money itself.
 */
const days = z
  .string()
  .trim()
  .regex(/^\d{1,2}$/, 'أدخل عدد أيام صحيحًا')
  .refine((value) => Number(value) >= 1 && Number(value) <= 31, 'أدخل عدد أيام بين 1 و 31');

/** Empty text from an untouched input is "not filled in", not an invalid amount. */
const blankOrAmount = amount.or(z.literal(''));
const blankOrDays = days.or(z.literal(''));

/**
 * Exactly one way of stating what an award is worth: a day count the server prices, or
 * an amount typed outright. Both would leave the figure ambiguous; neither would say
 * nothing at all.
 */
const pricedShape = {
  amount: blankOrAmount.optional(),
  days: blankOrDays.optional(),
};
/**
 * Exactly one way of stating what an award is worth: a day count the server prices, or
 * an amount typed outright. Both would leave the figure ambiguous; neither would say
 * nothing at all. Applied last, so the schema stays extendable for the reason field.
 */
const onePricedWay = <T extends z.ZodTypeAny>(schema: T) => schema.refine(
  (value: { amount?: string; days?: string }) =>
    ((value.amount ?? '') === '') !== ((value.days ?? '') === ''),
  { message: 'حدد المبلغ أو عدد الأيام، أحدهما فقط', path: ['days'] },
);

const payrollMonth = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, FORM_MESSAGES.required);

/** Client-side mirror of the contracts' bonus/deduction create schema. */
export const adjustmentCreateFormSchema = z.object({
  employeeId,
  ...pricedShape,
  payrollMonth,
});

/** The employee is immutable after creation; only the price and month may change. */
export const adjustmentUpdateFormSchema = z.object({
  ...pricedShape,
  payrollMonth,
});

const bonusReason = z
  .string()
  .trim()
  .min(1, 'أدخل سبب المكافأة')
  .max(500, 'يجب ألا يزيد سبب المكافأة عن 500 حرف');

const deductionReason = z
  .string()
  .trim()
  .min(1, 'أدخل سبب الخصم')
  .max(200, 'يجب ألا يزيد سبب الخصم عن 200 حرف');

export const bonusAdjustmentCreateFormSchema = onePricedWay(
  adjustmentCreateFormSchema.extend({ reason: bonusReason }),
);

export const bonusAdjustmentUpdateFormSchema = onePricedWay(
  adjustmentUpdateFormSchema.extend({ reason: bonusReason }),
);

export const deductionAdjustmentCreateFormSchema = onePricedWay(
  adjustmentCreateFormSchema.extend({ reason: deductionReason }),
);

export const deductionAdjustmentUpdateFormSchema = onePricedWay(
  adjustmentUpdateFormSchema.extend({ reason: deductionReason }),
);

export type AdjustmentCreateFormValues = z.infer<typeof adjustmentCreateFormSchema> & {
  reason?: string;
};
export type AdjustmentUpdateFormValues = z.infer<typeof adjustmentUpdateFormSchema> & {
  reason?: string;
};
