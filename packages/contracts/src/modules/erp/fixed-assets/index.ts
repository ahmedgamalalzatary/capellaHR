import { z } from 'zod';

import { coercedMysqlIntSchema, paginationPageSchema, paginationPageSizeSchema } from '../../../common/index.js';

/**
 * The fixed-assets register: what the branch owns and did not buy to sell —
 * chairs, air conditioners, mirrors. It is a written note, not an accounting
 * record: nothing else in the system reads it, so every detail beyond the name
 * is the admin's choice to fill in or leave blank.
 */
const cairoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح').refine((value) => {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = value.split('-').map(Number);
  if (year < 1000 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'التاريخ غير صالح');

/** Zero is allowed: a thing may be recorded before its price is known. */
const unitPriceSchema = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'السعر غير صالح').transform((value) => {
  const [whole = '', fraction = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/, '') || '0'}.${fraction.padEnd(2, '0')}`;
});

export const fixedAssetConditions = ['good', 'needs_repair', 'broken'] as const;

const nameSchema = z.string().trim().min(1, 'اسم الأصل مطلوب').max(255, 'اسم الأصل طويل جدًا');
const branchScope = { branchId: coercedMysqlIntSchema.optional() };
const fixedAssetFields = {
  name: nameSchema,
  quantity: coercedMysqlIntSchema.optional(),
  unitPrice: unitPriceSchema.optional(),
  location: z.string().trim().max(255, 'المكان طويل جدًا').optional(),
  note: z.string().trim().max(1000, 'الملاحظة طويلة جدًا').optional(),
  /** Null is how an edit clears a date written down by mistake. */
  purchasedOn: cairoDateSchema.nullable().optional(),
  condition: z.enum(fixedAssetConditions).nullable().optional(),
  ...branchScope,
};

export const createFixedAssetSchema = z.object(fixedAssetFields).strict();
export const updateFixedAssetSchema = z.object(fixedAssetFields).strict();
export const fixedAssetIdParamsSchema = z.object({ id: coercedMysqlIntSchema }).strict();
export const fixedAssetBranchQuerySchema = z.object(branchScope).strict();
export const listFixedAssetsQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  ...branchScope,
}).strict();

export type FixedAssetCondition = (typeof fixedAssetConditions)[number];
export type CreateFixedAssetInput = z.infer<typeof createFixedAssetSchema>;
export type UpdateFixedAssetInput = z.infer<typeof updateFixedAssetSchema>;
export type ListFixedAssetsQuery = z.infer<typeof listFixedAssetsQuerySchema>;
