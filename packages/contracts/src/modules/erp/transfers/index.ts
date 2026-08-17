import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
} from '../../../common/index.js';

const codePoints = (value: string) => [...value].length;
const optionalNote = z.string().refine((value) => codePoints(value) <= 500, 'الملاحظة طويلة جداً')
  .transform((value) => value.trim() || null);

const transferLineSchema = z.object({
  productId: coercedMysqlIntSchema,
  quantity: z.number().int().positive().max(2_147_483_647),
}).strict();

/**
 * A transfer is a sale from one branch to another: internal trade inside the
 * company. No employee sells it and no commission is earned, so it names only
 * the two branches and the products leaving the shelf.
 */
export const createStockTransferSchema = z.object({
  idempotencyKey: z.string().uuid(),
  sourceBranchId: coercedMysqlIntSchema,
  destinationBranchId: coercedMysqlIntSchema,
  note: optionalNote.optional(),
  lines: z.array(transferLineSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (value.sourceBranchId === value.destinationBranchId) {
    context.addIssue({
      code: 'custom',
      path: ['destinationBranchId'],
      message: 'يجب اختيار فرع مختلف عن الفرع المُرسِل',
    });
  }
  const seen = new Set<number>();
  value.lines.forEach((line, index) => {
    if (seen.has(line.productId)) {
      context.addIssue({
        code: 'custom',
        path: ['lines', index, 'productId'],
        message: 'لا يمكن تكرار المنتج',
      });
    }
    seen.add(line.productId);
  });
});

export const listStockTransfersQuerySchema = z.object({
  branchId: coercedMysqlIntSchema.optional(),
  productId: coercedMysqlIntSchema.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).strict().superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'نهاية الفترة تسبق بدايتها' });
  }
});

export type CreateStockTransferInput = z.infer<typeof createStockTransferSchema>;
export type ListStockTransfersQuery = z.infer<typeof listStockTransfersQuerySchema>;
