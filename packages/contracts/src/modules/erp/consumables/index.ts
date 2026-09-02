import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../../common/index.js';

const branchScope = { branchId: coercedMysqlIntSchema.optional() };
const quantity = z.string().regex(/^\d{1,13}(?:\.\d{1,3})?$/)
  .transform((value) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(3, '0')}`;
  })
  .refine((value) => Number(value) > 0, 'الكمية يجب أن تكون أكبر من صفر');
const packageSize = z.string().regex(/^\d{1,11}(?:\.\d{1,3})?$/)
  .transform((value) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(3, '0')}`;
  })
  .refine((value) => Number(value) > 0, 'حجم العبوة يجب أن يكون أكبر من صفر');

export const consumableUnitSchema = z.enum(['ml', 'gm']);

export const configureConsumableSchema = z.object({
  unit: consumableUnitSchema,
  packageSize,
  ...branchScope,
}).strict();

export const transferConsumableStockSchema = z.object({
  direction: z.enum(['reserve', 'return']),
  packages: z.number().int().positive().max(2_147_483_647),
  note: z.string().trim().min(1).max(500).optional(),
  ...branchScope,
}).strict();

const usageSchema = z.object({
  productId: coercedMysqlIntSchema,
  quantity,
}).strict();

const usagesSchema = z.array(usageSchema).max(100).superRefine((items, context) => {
  const seen = new Set<number>();
  items.forEach((item, index) => {
    if (seen.has(item.productId)) {
      context.addIssue({ code: 'custom', path: [index, 'productId'], message: 'تم تكرار المستهلك' });
    }
    seen.add(item.productId);
  });
});

export const completeServiceExecutionsSchema = z.object({
  serviceQueueEntryIds: z.array(coercedMysqlIntSchema).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'تم تكرار الخدمة'),
  usages: usagesSchema,
  ...branchScope,
}).strict();

export const correctServiceExecutionSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  usages: usagesSchema,
  ...branchScope,
}).strict();

export const listConsumableBalancesQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  ...branchScope,
}).strict();

export const listConsumableServicesQuerySchema = z.object({
  status: z.enum(['pending', 'completed', 'overdue']).optional(),
  cashierSessionId: coercedMysqlIntSchema.optional(),
  serviceId: coercedMysqlIntSchema.optional(),
  employeeId: coercedMysqlIntSchema.optional(),
  search: z.string().trim().min(1).max(255).optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  ...branchScope,
}).strict();

export type ConfigureConsumableInput = z.infer<typeof configureConsumableSchema>;
export type TransferConsumableStockInput = z.infer<typeof transferConsumableStockSchema>;
export type CompleteServiceExecutionsInput = z.infer<typeof completeServiceExecutionsSchema>;
export type CorrectServiceExecutionInput = z.infer<typeof correctServiceExecutionSchema>;
export type ListConsumableBalancesQuery = z.infer<typeof listConsumableBalancesQuerySchema>;
export type ListConsumableServicesQuery = z.infer<typeof listConsumableServicesQuerySchema>;
