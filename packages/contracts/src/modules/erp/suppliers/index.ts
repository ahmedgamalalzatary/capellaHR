import { z } from 'zod';

import { coercedMysqlIntSchema, paginationPageSchema, paginationPageSizeSchema } from '../../../common/index.js';

const codePoints = (value: string) => [...value].length;
const limited = (label: string, maximum: number) => z.string().trim().min(1).refine(
  (value) => codePoints(value) <= maximum,
  { message: `${label} طويل جداً` },
);
const optionalText = (maximum: number) => z.string().refine((value) => codePoints(value) <= maximum)
  .transform((value) => value.trim() || null);
const optionalPhone = z.string().refine((value) => codePoints(value.trim()) <= 50)
  .transform((value) => value.trim() || null);
const exactMoney = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'القيمة المالية غير صالحة')
  .transform((value, context) => {
    const [whole = '0', fraction = ''] = value.split('.');
    const normalized = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
    if (BigInt(normalized.replace('.', '')) <= BigInt(0)) {
      context.addIssue({ code: 'custom', message: 'تكلفة الوحدة يجب أن تكون أكبر من صفر' });
      return z.NEVER;
    }
    return normalized;
  });
const branchScope = { branchId: coercedMysqlIntSchema.optional() };

export const createSupplierSchema = z.object({
  name: limited('اسم المورد', 255),
  phone: optionalPhone.optional(),
  notes: optionalText(1000).optional(),
  ...branchScope,
}).strict();
export const updateSupplierSchema = z.object({
  name: limited('اسم المورد', 255).optional(), phone: optionalPhone.optional(),
  notes: optionalText(1000).optional(), isActive: z.boolean().optional(), ...branchScope,
}).strict().superRefine((value, context) => {
  if (!['name', 'phone', 'notes', 'isActive'].some((key) => key in value)) context.addIssue({ code: 'custom', message: 'يجب إرسال حقل واحد على الأقل' });
});
export const supplierIdParamsSchema = z.object({ id: coercedMysqlIntSchema });
export const listSuppliersQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  isActive: z.preprocess((value) => value === 'true' ? true : value === 'false' ? false : value, z.boolean()).optional(),
  page: paginationPageSchema.default(1), pageSize: paginationPageSizeSchema.default(20), ...branchScope,
}).strict();

const purchaseLineSchema = z.object({
  productId: coercedMysqlIntSchema,
  quantity: z.number().int().positive().max(2_147_483_647),
  unitCost: exactMoney,
}).strict();
export const createPurchaseSchema = z.object({
  idempotencyKey: z.string().uuid(),
  supplierId: coercedMysqlIntSchema,
  purchaseDate: z.string().date(),
  lines: z.array(purchaseLineSchema).min(1).max(100),
  correctsPurchaseId: coercedMysqlIntSchema.optional(),
  ...branchScope,
}).strict().superRefine((value, context) => {
  const seen = new Set<number>();
  let total = BigInt(0);
  value.lines.forEach((line, index) => {
    if (seen.has(line.productId)) context.addIssue({ code: 'custom', path: ['lines', index, 'productId'], message: 'لا يمكن تكرار المنتج' });
    seen.add(line.productId);
    const lineTotal = BigInt(line.unitCost.replace('.', '')) * BigInt(line.quantity);
    total += lineTotal;
    if (lineTotal > BigInt('999999999999')) context.addIssue({ code: 'custom', path: ['lines', index, 'unitCost'], message: 'إجمالي البند يتجاوز الحد المالي' });
  });
  if (total > BigInt('999999999999')) context.addIssue({ code: 'custom', path: ['lines'], message: 'إجمالي المشتريات يتجاوز الحد المالي' });
});
export const purchaseIdParamsSchema = z.object({ id: coercedMysqlIntSchema });
export const cancelPurchaseSchema = z.object({ reason: limited('سبب الإلغاء', 500), ...branchScope }).strict();
export const listPurchasesQuerySchema = z.object({
  supplierId: coercedMysqlIntSchema.optional(), productId: coercedMysqlIntSchema.optional(),
  status: z.enum(['posted', 'cancelled']).optional(), from: z.string().date().optional(), to: z.string().date().optional(),
  page: paginationPageSchema.default(1), pageSize: paginationPageSizeSchema.default(20), ...branchScope,
}).strict().superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) context.addIssue({ code: 'custom', path: ['to'], message: 'نهاية الفترة تسبق بدايتها' });
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type CancelPurchaseInput = z.infer<typeof cancelPurchaseSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
