import { z } from 'zod';

import { coercedMysqlIntSchema, positiveMysqlIntSchema } from '../../../common/index.js';

const isoDateTimeSchema = z.string().datetime({ offset: true });

export const cashierSessionCurrentQuerySchema = z.object({
  branchId: coercedMysqlIntSchema.optional(),
}).strict();

export const cashierSessionParamsSchema = z.object({
  sessionId: coercedMysqlIntSchema,
}).strict();

export const recoveryCloseCashierSessionSchema = z.object({
  reason: z.string().trim()
    .min(1, 'سبب الإغلاق الاستثنائي مطلوب')
    .max(1000, 'سبب الإغلاق الاستثنائي طويل جدًا'),
}).strict();

export const cashierSessionSchema = z.object({
  id: positiveMysqlIntSchema,
  branchId: positiveMysqlIntSchema,
  branchName: z.string().min(1).max(255),
  openedByAccountId: positiveMysqlIntSchema,
  openedByUsername: z.string().min(1).max(255),
  openedAt: isoDateTimeSchema,
  closedAt: isoDateTimeSchema.nullable(),
  closedByAccountId: positiveMysqlIntSchema.nullable(),
  closedByUsername: z.string().min(1).max(255).nullable(),
}).strict();

export type CashierSessionCurrentQuery = z.infer<typeof cashierSessionCurrentQuerySchema>;
export type RecoveryCloseCashierSessionInput = z.infer<typeof recoveryCloseCashierSessionSchema>;
export type CashierSessionDto = z.infer<typeof cashierSessionSchema>;
