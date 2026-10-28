import { z } from 'zod';

import { coercedMysqlIntSchema } from '../../../common/index.ts';

const productName = z.string().trim().min(1).refine(
  (value) => [...value].length <= 255,
  { message: 'اسم المنتج طويل جدًا' },
);

/** Which way the goods flow: A ⇒ B, decided when the link is created. */
export const createBranchLinkSchema = z.object({
  senderBranchId: coercedMysqlIntSchema,
  receiverBranchId: coercedMysqlIntSchema,
}).strict();

export const branchLinkParamsSchema = z.object({ id: coercedMysqlIntSchema });
export const setupRowParamsSchema = z.object({
  id: coercedMysqlIntSchema,
  productId: coercedMysqlIntSchema,
});

/**
 * One settled answer for one of A's products. `link` covers both "the system
 * picked the wrong row" and "the admin picked another product": it always
 * replaces whatever answer was there.
 */
export const settleProductLinkSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('link'),
    receiverProductId: coercedMysqlIntSchema,
  }).strict(),
  /** The A product is not the B product it was compared with; never ask again. */
  z.object({
    action: z.literal('exclude'),
    notSameAsProductId: coercedMysqlIntSchema.nullable().default(null),
  }).strict(),
  /** Create B's copy right now, under the name the admin typed. */
  z.object({
    action: z.literal('create'),
    name: productName,
  }).strict(),
]);

export type CreateBranchLinkInput = z.infer<typeof createBranchLinkSchema>;
export type SettleProductLinkInput = z.infer<typeof settleProductLinkSchema>;
