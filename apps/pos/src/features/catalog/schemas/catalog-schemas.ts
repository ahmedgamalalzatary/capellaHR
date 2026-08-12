import {
  createCategorySchema,
  createServiceSchema,
  setServiceCommissionOverrideSchema,
} from '@capella/contracts';
import { z } from 'zod';

/**
 * Reuses the contract rules so the browser validates and normalizes exactly the
 * way the server does; the server remains the authority either way. Native
 * selects and inputs hand back strings, so each field is piped through the
 * contract's own coercion.
 */
const requiredText = (message: string) => z.string().trim().min(1, message);

export const categoryFormSchema = z.object({
  name: requiredText('اسم التصنيف مطلوب').pipe(createCategorySchema.shape.name),
  type: createCategorySchema.shape.type,
});

export const serviceFormSchema = z.object({
  name: requiredText('اسم الخدمة مطلوب').pipe(createServiceSchema.shape.name),
  categoryId: requiredText('يجب اختيار التصنيف').pipe(createServiceSchema.shape.categoryId),
  price: z.string().trim()
    .transform((value) => (value === '' ? null : value))
    .pipe(createServiceSchema.shape.price),
  // An empty commission box means "no commission", not a validation failure.
  commissionPercent: z.string().trim()
    .transform((value) => (value === '' ? '0' : value))
    .pipe(createServiceSchema.shape.commissionPercent),
  description: z.string().optional().default('')
    .pipe(createServiceSchema.shape.description)
    .transform((value) => value ?? null),
});

export const commissionOverrideFormSchema = z.object({
  employeeId: requiredText('يجب اختيار الموظف')
    .pipe(setServiceCommissionOverrideSchema.shape.employeeId),
  commissionPercent: requiredText('نسبة العمولة مطلوبة')
    .pipe(setServiceCommissionOverrideSchema.shape.commissionPercent),
});

/**
 * The controls hand back strings while the contract yields numbers and
 * normalized money, so the browser form is typed on both ends: `…FormInput` is
 * what the fields hold, `…FormValues` is what a valid submit produces.
 */
export type CategoryFormValues = z.infer<typeof categoryFormSchema>;
export type ServiceFormInput = z.input<typeof serviceFormSchema>;
export type ServiceFormValues = z.output<typeof serviceFormSchema>;
export type CommissionOverrideFormInput = z.input<typeof commissionOverrideFormSchema>;
export type CommissionOverrideFormValues = z.output<typeof commissionOverrideFormSchema>;
