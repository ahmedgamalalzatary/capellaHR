import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
  positiveMysqlIntSchema,
} from '../../../common/index.js';

const payrollMonthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
const moneySchema = z.string().regex(/^\d{1,12}\.\d{2}$/);
const signedMoneySchema = z.string().regex(/^-?\d{1,12}\.\d{2}$/);

export const commissionListQuerySchema = z.object({
  month: payrollMonthSchema,
  branchId: coercedMysqlIntSchema.optional(),
  employeeId: coercedMysqlIntSchema.optional(),
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
}).strict();

export const commissionMonthParamsSchema = z.object({
  employeeId: coercedMysqlIntSchema,
  month: payrollMonthSchema,
}).strict();

export const commissionSummarySchema = z.object({
  employeeId: positiveMysqlIntSchema,
  employeeCode: positiveMysqlIntSchema,
  employeeName: z.string().min(1).max(255),
  payrollMonth: payrollMonthSchema,
  earnedAmount: moneySchema,
  reversedAmount: moneySchema,
  netAmount: moneySchema,
  invoiceLineCount: z.number().int().min(0),
  reversalCount: z.number().int().min(0),
}).strict();

export const commissionEntrySchema = z.object({
  id: positiveMysqlIntSchema,
  type: z.enum(['earned', 'reversal']),
  invoiceId: positiveMysqlIntSchema,
  invoiceNumber: z.string().regex(/^INV-\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}-\d+$/),
  invoiceLineId: positiveMysqlIntSchema,
  lineNumber: positiveMysqlIntSchema,
  serviceName: z.string().min(1).max(255),
  baseAmount: moneySchema,
  commissionRate: z.string().regex(/^\d{1,3}\.\d{2}$/),
  amount: signedMoneySchema,
  reversalId: positiveMysqlIntSchema.nullable(),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();

export const commissionDetailSchema = z.object({
  summary: commissionSummarySchema,
  entries: z.array(commissionEntrySchema),
}).strict();

export type CommissionListQuery = z.infer<typeof commissionListQuerySchema>;
export type CommissionMonthParams = z.infer<typeof commissionMonthParamsSchema>;
export type CommissionSummary = z.infer<typeof commissionSummarySchema>;
export type CommissionEntry = z.infer<typeof commissionEntrySchema>;
export type CommissionDetail = z.infer<typeof commissionDetailSchema>;
