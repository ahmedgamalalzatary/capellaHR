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

/**
 * A price that is either a valid figure or genuinely blank. The blank test runs on
 * the trimmed value, so a stray space in an untouched field counts as "not filled in"
 * rather than as a malformed amount.
 */
const blankOrAmount = z.string().trim().refine(
  (value) => value === '' || /^\d{1,10}(?:\.\d{1,2})?$/.test(value),
  'أدخل مبلغًا صالحًا بالجنيه',
).refine((value) => value === '' || Number(value) > 0, 'أدخل مبلغًا أكبر من صفر');
const blankOrDays = z.string().trim().refine(
  (value) => value === '' || /^\d{1,2}$/.test(value),
  'أدخل عدد أيام صحيحًا',
).refine(
  (value) => value === '' || (Number(value) >= 1 && Number(value) <= 31),
  'أدخل عدد أيام بين 1 و 31',
);

/**
 * The two prices a form can carry, either of which may be left blank. The shape is
 * kept separate from the rule so a schema stays extendable for the reason field.
 */
const pricedShape = {
  amount: blankOrAmount.optional(),
  days: blankOrDays.optional(),
};
/**
 * Exactly one way of stating what an award is worth: a day count the server prices, or
 * an amount typed outright. Both would leave the figure ambiguous; neither would say
 * nothing at all. Whitespace counts as blank here too, so two empty-looking fields are
 * still "neither". Applied last, after every field has been trimmed.
 */
const onePricedWay = <T extends typeof pricedShape>(schema: z.ZodObject<T>) => schema.refine(
  (value) => ((value.amount ?? '') === '') !== ((value.days ?? '') === ''),
  { message: 'حدد المبلغ أو عدد الأيام، أحدهما فقط', path: ['days'] },
);

const payrollMonth = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, FORM_MESSAGES.required);

/**
 * Plain shapes, not the exported schemas: `onePricedWay` returns an effects wrapper,
 * which has no `.extend()`. The rule is applied once at the end, on the finished form.
 */
const createShape = z.object({
  employeeId,
  ...pricedShape,
  payrollMonth,
});

const updateShape = z.object({
  ...pricedShape,
  payrollMonth,
});

/** Client-side mirror of the contracts' bonus/deduction create schema. */
export const adjustmentCreateFormSchema = onePricedWay(createShape);

/** The employee is immutable after creation; only the price and month may change. */
export const adjustmentUpdateFormSchema = onePricedWay(updateShape);

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
  createShape.extend({ reason: bonusReason }),
);

export const bonusAdjustmentUpdateFormSchema = onePricedWay(
  updateShape.extend({ reason: bonusReason }),
);

export const deductionAdjustmentCreateFormSchema = onePricedWay(
  createShape.extend({ reason: deductionReason }),
);

export const deductionAdjustmentUpdateFormSchema = onePricedWay(
  updateShape.extend({ reason: deductionReason }),
);

export type AdjustmentCreateFormValues = z.infer<typeof adjustmentCreateFormSchema> & {
  reason?: string;
};
export type AdjustmentUpdateFormValues = z.infer<typeof adjustmentUpdateFormSchema> & {
  reason?: string;
};
