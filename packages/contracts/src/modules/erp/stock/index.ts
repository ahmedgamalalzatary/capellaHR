import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../../common/index.js';

const codePoints = (value: string) => [...value].length;
const productName = z.string().trim().min(1).refine((value) => codePoints(value) <= 255, {
  message: 'اسم المنتج طويل جدًا',
});
const description = z.string().refine((value) => codePoints(value) <= 1000, {
  message: 'وصف المنتج طويل جدًا',
}).transform((value) => value.trim() || null);
const note = z.string().trim().min(1).refine((value) => codePoints(value) <= 500, {
  message: 'ملاحظة الحركة طويلة جدًا',
});
const money = (positive: boolean) => z.string()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'القيمة المالية غير صالحة')
  .transform((value, context) => {
    const [whole = '', fraction = ''] = value.split('.');
    const normalized = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
    if (positive ? Number(normalized) <= 0 : Number(normalized) < 0) {
      context.addIssue({ code: 'custom', message: positive ? 'السعر يجب أن يكون أكبر من صفر' : 'التكلفة لا يمكن أن تكون سالبة' });
      return z.NEVER;
    }
    return normalized;
  });
const queryBoolean = z.preprocess(
  (value) => value === 'true' ? true : value === 'false' ? false : value,
  z.boolean(),
);
const branchScope = { branchId: coercedMysqlIntSchema.optional() };
const hasEditableField = (value: Record<string, unknown>, context: z.RefinementCtx) => {
  if (!['name', 'description', 'sellingPrice', 'lastPurchaseCost', 'lowStockThreshold', 'isActive'].some((key) => key in value)) {
    context.addIssue({ code: 'custom', message: 'يجب إرسال حقل واحد على الأقل' });
  }
};

export const createProductSchema = z.object({
  name: productName,
  description: description.optional(),
  sellingPrice: money(true),
  lastPurchaseCost: money(false).default('0'),
  lowStockThreshold: z.number().int().nonnegative().max(2_147_483_647).default(0),
  ...branchScope,
}).strict();

export const updateProductSchema = z.object({
  name: productName.optional(),
  description: description.optional(),
  sellingPrice: money(true).optional(),
  lastPurchaseCost: money(false).optional(),
  lowStockThreshold: z.number().int().nonnegative().max(2_147_483_647).optional(),
  isActive: z.boolean().optional(),
  ...branchScope,
}).strict().superRefine(hasEditableField);

export const productIdParamsSchema = z.object({ id: coercedMysqlIntSchema });
export const listProductsQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  isActive: queryBoolean.optional(),
  lowStock: queryBoolean.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  ...branchScope,
}).strict();
export const stockAdjustmentReasonSchema = z.enum(['count_correction', 'wastage', 'damage']);
export const adjustProductStockSchema = z.object({
  quantityDelta: z.number().int().min(-2_147_483_648).max(2_147_483_647).refine((value) => value !== 0, {
    message: 'تغيير الكمية يجب ألا يساوي صفرًا',
  }),
  reason: stockAdjustmentReasonSchema,
  note: note.optional(),
  ...branchScope,
}).strict().superRefine((value, context) => {
  if ((value.reason === 'wastage' || value.reason === 'damage') && value.quantityDelta > 0) {
    context.addIssue({ code: 'custom', path: ['quantityDelta'], message: 'الهالك والتالف يجب أن يخفضا المخزون' });
  }
});
export const listStockMovementsQuerySchema = z.object({
  productId: coercedMysqlIntSchema.optional(),
  reason: z.enum(['opening_stock', 'count_correction', 'wastage', 'damage', 'sale', 'purchase', 'purchase_cancellation', 'refund', 'void']).optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  ...branchScope,
}).strict();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type AdjustProductStockInput = z.infer<typeof adjustProductStockSchema>;
export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;
export type StockAdjustmentReason = z.infer<typeof stockAdjustmentReasonSchema>;
