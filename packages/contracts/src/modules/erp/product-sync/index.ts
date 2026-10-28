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

/** Setup choices are submitted once, when the administrator confirms activation. */
export const confirmBranchLinkSchema = z.object({
  decisions: z.array(z.object({
    senderProductId: coercedMysqlIntSchema,
    decision: settleProductLinkSchema,
  }).strict()).default([]),
}).strict().superRefine((input, context) => {
  const seen = new Set<number>();
  input.decisions.forEach((entry, index) => {
    if (seen.has(entry.senderProductId)) {
      context.addIssue({ code: 'custom', path: ['decisions', index, 'senderProductId'], message: 'اختر قرارًا واحدًا لكل منتج' });
    }
    seen.add(entry.senderProductId);
  });
});
export type ConfirmBranchLinkInput = z.infer<typeof confirmBranchLinkSchema>;

export const syncIssueParamsSchema = z.object({ issueId: coercedMysqlIntSchema });
export const linkedProductsQuerySchema = z.object({ branchId: coercedMysqlIntSchema }).strict();

/**
 * The "needs attention" answers: the same three a setup row offers, plus a
 * retry for a copy that failed for a reason a retry can clear.
 */
export const settleSyncIssueSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('link'),
    receiverProductId: coercedMysqlIntSchema,
  }).strict(),
  z.object({
    action: z.literal('exclude'),
    notSameAsProductId: coercedMysqlIntSchema.nullable().default(null),
  }).strict(),
  z.object({
    action: z.literal('create'),
    name: productName,
  }).strict(),
  z.object({ action: z.literal('retry') }).strict(),
]);

export type SettleSyncIssueInput = z.infer<typeof settleSyncIssueSchema>;
