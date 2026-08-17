import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../../common/index.js';

// MySQL VARCHAR limits count characters (code points), not UTF-16 units.
const codePoints = (value: string) => [...value].length;

const boundedName = (max: number, tooLong: string) => z.string().trim().min(1)
  .refine((value) => codePoints(value) <= max, { message: tooLong });

const categoryName = boundedName(255, 'اسم التصنيف طويل جدًا');
const serviceName = boundedName(255, 'اسم الخدمة طويل جدًا');

/**
 * Money is exact EGP: it always arrives as a decimal string and is normalized to
 * two decimals, so a float can never reach the database. This mirrors the HR
 * payroll money rule rather than importing it, because the ERP boundary keeps
 * ERP contracts off HR modules.
 */
const servicePrice = z.string()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'السعر يجب أن يكون رقمًا موجبًا بحد أقصى منزلتين عشريتين')
  .transform((value, context) => {
    const [whole = '', fraction = ''] = value.split('.');
    const normalized = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
    if (Number(normalized) === 0) {
      context.addIssue({ code: 'custom', message: 'السعر يجب أن يكون أكبر من صفر' });
      return z.NEVER;
    }
    return normalized;
  });

/**
 * A commission rate is an exact percentage of the pre-discount sale unit price.
 * Zero is legitimate — it means the service earns no commission.
 */
const commissionPercent = z.string()
  .regex(/^\d{1,3}(?:\.\d{1,2})?$/, 'نسبة العمولة يجب أن تكون رقمًا بين 0 و 100')
  .transform((value, context) => {
    const [whole = '', fraction = ''] = value.split('.');
    const normalized = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
    if (Number(normalized) > 100) {
      context.addIssue({ code: 'custom', message: 'نسبة العمولة يجب أن تكون رقمًا بين 0 و 100' });
      return z.NEVER;
    }
    return normalized;
  });

/** An absent or blank description is stored as SQL NULL, never as an empty string. */
const serviceDescription = z.string()
  .refine((value) => codePoints(value) <= 1000, { message: 'وصف الخدمة طويل جدًا' })
  .transform((value) => (value.trim() === '' ? null : value.trim()));

/** Browsers send query flags as text; `?isActive=false` must not read as true. */
const queryBoolean = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean(),
);

/** Only services are categorised; an expense carries its own name instead. */
export const erpCategoryTypeSchema = z.enum(['service']);

/**
 * `branchId` is optional on every operation and is never trusted as the branch
 * identity: the server resolves the acting branch from the account. An Admin
 * must supply it (they belong to no branch); a Cashier may omit it, and
 * supplying another branch's id is rejected.
 */
const branchScope = { branchId: coercedMysqlIntSchema.optional() };

const hasEditableField = (keys: readonly string[]) => (
  value: Record<string, unknown>,
  context: z.RefinementCtx,
) => {
  if (!keys.some((key) => key in value)) {
    context.addIssue({ code: 'custom', message: 'يجب إرسال حقل واحد على الأقل' });
  }
};

export const createCategorySchema = z.object({
  name: categoryName,
  type: erpCategoryTypeSchema,
  ...branchScope,
}).strict();

/** The type is deliberately absent: a category's type is fixed at creation. */
export const updateCategorySchema = z.object({
  name: categoryName.optional(),
  isActive: z.boolean().optional(),
  ...branchScope,
}).strict().superRefine(hasEditableField(['name', 'isActive']));

export const categoryIdParamsSchema = z.object({ id: coercedMysqlIntSchema });

export const listCategoriesQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  type: erpCategoryTypeSchema.optional(),
  isActive: queryBoolean.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  ...branchScope,
}).strict();

export const createServiceSchema = z.object({
  name: serviceName,
  categoryId: coercedMysqlIntSchema,
  price: servicePrice.nullable().default(null),
  description: serviceDescription.optional(),
  commissionPercent: commissionPercent.default('0'),
  ...branchScope,
}).strict();

export const updateServiceSchema = z.object({
  name: serviceName.optional(),
  categoryId: coercedMysqlIntSchema.optional(),
  price: servicePrice.nullable().optional(),
  description: serviceDescription.optional(),
  commissionPercent: commissionPercent.optional(),
  isActive: z.boolean().optional(),
  ...branchScope,
}).strict().superRefine(hasEditableField([
  'name', 'categoryId', 'price', 'description', 'commissionPercent', 'isActive',
]));

export const serviceIdParamsSchema = z.object({ id: coercedMysqlIntSchema });

export const listServicesQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  categoryId: coercedMysqlIntSchema.optional(),
  isActive: queryBoolean.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  ...branchScope,
}).strict();

export const setServiceCommissionOverrideSchema = z.object({
  employeeId: coercedMysqlIntSchema,
  commissionPercent,
  ...branchScope,
}).strict();

export const serviceCommissionOverrideParamsSchema = z.object({
  id: coercedMysqlIntSchema,
  employeeId: coercedMysqlIntSchema,
});

export type ErpCategoryType = z.infer<typeof erpCategoryTypeSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;
export type SetServiceCommissionOverrideInput = z.infer<typeof setServiceCommissionOverrideSchema>;
