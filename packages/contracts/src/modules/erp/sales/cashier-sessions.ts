import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
  positiveMysqlIntSchema,
} from '../../../common/index.ts';
import {
  exactMoneySchema,
  invoiceNumberSchema,
  isoDateTimeSchema,
  normalizeDecimal,
  paymentMethodSchema,
  positiveMoneySchema,
  toCents,
} from './sale-commands.ts';

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
  /** Set when the system ended the shift at its sixteen-hour limit. */
  autoClosedAt: isoDateTimeSchema.nullable(),
}).strict();

export type CashierSessionCurrentQuery = z.infer<typeof cashierSessionCurrentQuerySchema>;
export type RecoveryCloseCashierSessionInput = z.infer<typeof recoveryCloseCashierSessionSchema>;
export type CashierSessionDto = z.infer<typeof cashierSessionSchema>;
export const cashierSessionListQuerySchema = z.object({
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  branchId: coercedMysqlIntSchema.optional(),
}).strict();

/** Every method is always present, so a till reads as a full set of drawers. */
const shiftMoneyByMethodSchema = z.object({
  cash: exactMoneySchema,
  visa: exactMoneySchema,
  instapay: exactMoneySchema,
  vodafone_cash: exactMoneySchema,
}).strict();

/** A shift can hand back more than it took, so its net carries a sign. */
const signedMoneySchema = z.string()
  .regex(/^-?\d{1,12}(?:\.\d{1,2})?$/, 'يجب إدخال مبلغ صحيح بدقة قرش واحد')
  .transform((value) => (value.startsWith('-')
    ? `-${normalizeDecimal(value.slice(1))}`
    : normalizeDecimal(value)));

const signedToCents = (value: string) => (
  value.startsWith('-') ? -toCents(value.slice(1)) : toCents(value)
);

const sumMethods = (value: Record<string, string>) => Object.values(value)
  .reduce((total, amount) => total + toCents(amount), BigInt(0));

export const cashierSessionSummarySchema = cashierSessionSchema.extend({
  /** Elapsed so far while the shift is still open, total once it has closed. */
  durationMinutes: z.number().int().min(0),
  saleCount: z.number().int().min(0),
  taken: shiftMoneyByMethodSchema,
  refunded: shiftMoneyByMethodSchema,
  takenTotal: exactMoneySchema,
  refundedTotal: exactMoneySchema,
  expenses: signedMoneySchema,
  net: signedMoneySchema,
}).strict().superRefine((value, context) => {
  const check = (path: string, expected: bigint, actual: string) => {
    if (expected !== toCents(actual)) {
      context.addIssue({ code: 'custom', path: [path], message: 'إجمالي الوردية غير متسق' });
    }
  };
  check('takenTotal', sumMethods(value.taken), value.takenTotal);
  check('refundedTotal', sumMethods(value.refunded), value.refundedTotal);
  if (toCents(value.takenTotal) - toCents(value.refundedTotal) - signedToCents(value.expenses) !== signedToCents(value.net)) {
    context.addIssue({ code: 'custom', path: ['net'], message: 'إجمالي الوردية غير متسق' });
  }
});

const signedShiftMoneyByMethodSchema = z.object({
  cash: signedMoneySchema,
  visa: signedMoneySchema,
  instapay: signedMoneySchema,
  vodafone_cash: signedMoneySchema,
}).strict();

export const cashierSessionReportSchema = z.object({
  summary: cashierSessionSummarySchema,
  sales: z.object({
    gross: exactMoneySchema,
    returns: exactMoneySchema,
    total: signedMoneySchema,
    discount: signedMoneySchema,
    tax: signedMoneySchema,
    net: signedMoneySchema,
  }).strict(),
  expenses: signedMoneySchema,
  collectedPayments: exactMoneySchema,
  collectedPaymentLines: z.array(z.object({
    invoiceNumber: invoiceNumberSchema,
    client: z.object({
      id: positiveMysqlIntSchema,
      name: z.string().min(1).max(255).nullable(),
      phone: z.string().regex(/^01[0125]\d{8}$/).nullable(),
    }).strict(),
    method: paymentMethodSchema,
    amount: positiveMoneySchema,
    paidAt: isoDateTimeSchema,
  }).strict()),
  creditSales: exactMoneySchema,
  netByMethod: signedShiftMoneyByMethodSchema,
}).strict().superRefine((value, context) => {
  const sales = value.sales;
  const expectedTotal = toCents(sales.gross) - toCents(sales.returns);
  const expectedNet = expectedTotal - signedToCents(sales.discount) + signedToCents(sales.tax);
  if (signedToCents(sales.total) !== expectedTotal) {
    context.addIssue({ code: 'custom', path: ['sales', 'total'], message: 'إجمالي مبيعات الوردية غير متسق' });
  }
  if (signedToCents(sales.net) !== expectedNet) {
    context.addIssue({ code: 'custom', path: ['sales', 'net'], message: 'صافي مبيعات الوردية غير متسق' });
  }
  const methodNet = Object.values(value.netByMethod)
    .reduce((total, amount) => total + signedToCents(amount), BigInt(0));
  if (methodNet !== signedToCents(value.summary.net)) {
    context.addIssue({ code: 'custom', path: ['netByMethod'], message: 'صافي وسائل الدفع غير متسق' });
  }
  if (signedToCents(value.expenses) !== signedToCents(value.summary.expenses)) {
    context.addIssue({ code: 'custom', path: ['expenses'], message: 'مصروفات الوردية غير متسقة' });
  }
});

export const cashierSessionInvoiceSchema = z.object({
  id: positiveMysqlIntSchema,
  invoiceNumber: invoiceNumberSchema,
  status: z.enum(['completed', 'partially_refunded', 'refunded', 'voided']),
  client: z.object({
    id: positiveMysqlIntSchema,
    name: z.string().min(1).max(255).nullable(),
    phone: z.string().regex(/^01[0125]\d{8}$/).nullable(),
  }).strict(),
  total: exactMoneySchema,
  /**
   * What this shift took and handed back on this invoice, which is not the
   * invoice total once an invoice can be paid across two shifts.
   */
  takenInShift: exactMoneySchema,
  refundedInShift: exactMoneySchema,
  soldAt: isoDateTimeSchema,
}).strict();

export const cashierSessionDetailSchema = z.object({
  summary: cashierSessionSummarySchema,
  invoices: z.array(cashierSessionInvoiceSchema),
}).strict();

export type CashierSessionListQuery = z.infer<typeof cashierSessionListQuerySchema>;
export type CashierSessionSummaryDto = z.infer<typeof cashierSessionSummarySchema>;
export type CashierSessionReportDto = z.infer<typeof cashierSessionReportSchema>;
export type CashierSessionInvoiceDto = z.infer<typeof cashierSessionInvoiceSchema>;
export type CashierSessionDetailDto = z.infer<typeof cashierSessionDetailSchema>;
