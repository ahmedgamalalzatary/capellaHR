import { z } from 'zod';

/**
 * Positive EGP amount with at most two decimals, kept as a string for the
 * API's exact-decimal money contract.
 */
export const baseSalaryFormSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'أدخل مبلغًا صالحًا بالجنيه')
    .refine((value) => Number(value) > 0, 'أدخل مبلغًا أكبر من صفر'),
});

export type BaseSalaryFormValues = z.infer<typeof baseSalaryFormSchema>;
