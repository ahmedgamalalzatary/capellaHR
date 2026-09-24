import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  positiveMysqlIntSchema,
} from '../../../common/index.ts';

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const invoiceNumberSchema = z.string().regex(/^(?:INV-\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}-\d+|(?!0+$)\d{6,})$/);

export const normalizeDecimal = (value: string) => {
  const [whole = '', fraction = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
};

export const exactMoneySchema = z.string()
  .regex(/^\d{1,12}(?:\.\d{1,2})?$/, 'يجب إدخال مبلغ صحيح بدقة قرش واحد')
  .transform(normalizeDecimal);

export const positiveMoneySchema = exactMoneySchema.refine(
  (value) => value !== '0.00',
  'يجب أن يكون المبلغ أكبر من صفر',
);

// Invoice lines use decimal(12,2): at most ten whole digits plus two decimals.
export const serviceUnitPriceSchema = z.string()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'يجب إدخال سعر صحيح بدقة قرش واحد')
  .transform(normalizeDecimal)
  .refine((value) => value !== '0.00', 'يجب أن يكون السعر أكبر من صفر');

export const percentageSchema = z.string()
  .regex(/^\d{1,3}(?:\.\d{1,2})?$/, 'يجب إدخال نسبة صحيحة')
  .transform(normalizeDecimal)
  .refine((value) => Number(value) <= 100, 'يجب ألا تتجاوز النسبة 100');

export const toCents = (value: string) => {
  const [whole = '0', fraction = '00'] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

export const percentageAmount = (base: string, percentage: string) => {
  const numerator = toCents(base) * toCents(percentage);
  return (numerator + BigInt(5000)) / BigInt(10000);
};

export const paymentMethodSchema = z.enum(['cash', 'visa', 'instapay', 'vodafone_cash']);
export const saleItemTypeSchema = z.enum(['service', 'product']);
export const adjustmentKindSchema = z.enum(['percentage', 'fixed']);
export const commissionRuleSchema = z.enum(['service_default', 'employee_override', 'none']);

export const adjustmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percentage'), value: percentageSchema }).strict(),
  z.object({ kind: z.literal('fixed'), value: exactMoneySchema }).strict(),
]);

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

const serviceSaleLineSchema = z.object({
  itemType: z.literal('service'),
  serviceId: positiveMysqlIntSchema,
  quantity: positiveMysqlIntSchema.max(100),
  unitPrice: serviceUnitPriceSchema,
});

const productSaleLineSchema = z.object({
  itemType: z.literal('product'),
  productId: positiveMysqlIntSchema,
  quantity: positiveMysqlIntSchema,
});

/** A quote prices the basket; nobody has been assigned to perform it yet. */
const saleLineSchema = z.discriminatedUnion('itemType', [
  serviceSaleLineSchema.strict(),
  productSaleLineSchema.strict(),
]);

/**
 * On a posted sale each service names the one employee who performed it, so a
 * single invoice can pay commission to several people. Products earn none and
 * therefore name nobody.
 */
const completeSaleLineSchema = z.discriminatedUnion('itemType', [
  serviceSaleLineSchema.extend({ employeeId: positiveMysqlIntSchema }).strict(),
  productSaleLineSchema.strict(),
]);

export const paymentSchema = z.object({
  method: paymentMethodSchema,
  amount: positiveMoneySchema,
}).strict();

const reversalCommandBaseSchema = z.object({
  branchId: positiveMysqlIntSchema.optional(),
  idempotencyKey: z.string().uuid(),
  reason: z.string().trim()
    .min(1, 'سبب الإلغاء أو الاسترداد مطلوب')
    .max(1000, 'سبب الإلغاء أو الاسترداد طويل جدًا'),
});

export const voidInvoiceSchema = reversalCommandBaseSchema.strict();

const refundLineSelectionSchema = z.object({
  invoiceLineId: positiveMysqlIntSchema,
  quantity: positiveMysqlIntSchema,
}).strict();

const rejectDuplicateRefundLines = (
  value: { lines: Array<{ invoiceLineId: number }> },
  context: z.RefinementCtx,
) => {
  const seen = new Set<number>();
  value.lines.forEach((line, index) => {
    if (seen.has(line.invoiceLineId)) {
      context.addIssue({
        code: 'custom', path: ['lines', index, 'invoiceLineId'], message: 'لا يمكن تكرار البند',
      });
    }
    seen.add(line.invoiceLineId);
  });
};

export const refundInvoiceSchema = reversalCommandBaseSchema.extend({
  lines: z.array(refundLineSelectionSchema).min(1).max(100),
  payments: z.array(paymentSchema).max(paymentMethodSchema.options.length),
}).strict().superRefine((value, context) => {
  rejectDuplicateRefundLines(value, context);
  const seenMethods = new Set<PaymentMethod>();
  value.payments.forEach((payment, index) => {
    if (seenMethods.has(payment.method)) {
      context.addIssue({
        code: 'custom', path: ['payments', index, 'method'], message: 'لا يمكن تكرار البند',
      });
    }
    seenMethods.add(payment.method);
  });
});

export const reassignInvoiceLineSchema = z.object({
  branchId: positiveMysqlIntSchema.optional(),
  employeeId: positiveMysqlIntSchema,
  operationReference: z.string().uuid(),
  reason: z.string().trim()
    .min(1, 'سبب تغيير الموظف مطلوب')
    .max(1000, 'سبب تغيير الموظف طويل جدًا'),
}).strict();

export const recordInvoicePaymentSchema = z.object({
  branchId: positiveMysqlIntSchema.optional(),
  cashierSessionId: positiveMysqlIntSchema,
  method: paymentMethodSchema,
  amount: positiveMoneySchema,
  operationReference: z.string().uuid(),
}).strict();

export const invoiceLineParamsSchema = z.object({
  invoiceId: coercedMysqlIntSchema,
  lineId: coercedMysqlIntSchema,
}).strict();

export const refundQuoteInputSchema = z.object({
  branchId: coercedMysqlIntSchema.optional(),
  lines: z.array(refundLineSelectionSchema).min(1).max(100),
}).strict().superRefine(rejectDuplicateRefundLines);

const reversalAmountLineSchema = refundLineSelectionSchema.extend({
  grossAmount: positiveMoneySchema,
  discountAmount: exactMoneySchema,
  taxAmount: exactMoneySchema,
  total: exactMoneySchema,
}).strict();

export const refundQuoteSchema = z.object({
  lines: z.array(reversalAmountLineSchema).min(1),
  totals: z.object({
    grossAmount: positiveMoneySchema,
    discountAmount: exactMoneySchema,
    taxAmount: exactMoneySchema,
    total: exactMoneySchema,
  }).strict(),
  cashPayout: exactMoneySchema,
  /**
   * Every method is offered, not only the ones the sale used: the cashier decides
   * how the money physically goes back. `paidAmount` is what the till originally
   * took on that method and `refundableAmount` what is still left on it, so the
   * screen can prefill the ordinary same-method split and still allow another.
   */
  payments: z.array(z.object({
    method: paymentMethodSchema,
    paidAmount: exactMoneySchema,
    refundableAmount: exactMoneySchema,
  }).strict().superRefine((value, context) => {
    if (toCents(value.refundableAmount) > toCents(value.paidAmount)) {
      context.addIssue({
        code: 'custom', path: ['refundableAmount'], message: 'مبالغ الاسترداد غير متسقة',
      });
    }
  })),
}).strict().superRefine((value, context) => {
  if (toCents(value.cashPayout) > toCents(value.totals.total)) {
    context.addIssue({ code: 'custom', path: ['cashPayout'], message: 'المبلغ النقدي أكبر من قيمة المرتجع' });
  }
});

export const paymentBreakdownSchema = z.object({
  total: exactMoneySchema,
  payments: z.array(paymentSchema),
  allowPartialPayment: z.boolean().optional(),
  allowRepeatedMethods: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  const paymentTotal = value.payments.reduce(
    (sum, payment) => sum + toCents(payment.amount),
    BigInt(0),
  );
  if ((!value.allowPartialPayment && paymentTotal !== toCents(value.total))
    || (value.allowPartialPayment && paymentTotal > toCents(value.total))) {
    context.addIssue({
      code: 'custom',
      path: ['payments'],
      message: 'مجموع المدفوعات لا يساوي إجمالي الفاتورة',
    });
  }
  const methods = value.payments.map(({ method }) => method);
  if (!value.allowRepeatedMethods && methods.length > paymentMethodSchema.options.length) {
    context.addIssue({ code: 'custom', path: ['payments'], message: 'عدد وسائل الدفع غير صالح' });
  }
  if (!value.allowRepeatedMethods && new Set(methods).size !== methods.length) {
    context.addIssue({ code: 'custom', path: ['payments'], message: 'لا يمكن تكرار وسيلة الدفع' });
  }
});

export const completeSaleSchema = z.object({
  branchId: positiveMysqlIntSchema.optional(),
  clientId: positiveMysqlIntSchema,
  sellerEmployeeId: positiveMysqlIntSchema,
  cashierSessionId: positiveMysqlIntSchema,
  bookingId: positiveMysqlIntSchema.optional(),
  idempotencyKey: z.string().uuid(),
  lines: z.array(completeSaleLineSchema).min(1).max(100),
  discount: adjustmentSchema.optional(),
  tax: adjustmentSchema.optional(),
  payments: z.array(paymentSchema).max(paymentMethodSchema.options.length),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  value.payments.forEach((payment, index) => {
    if (seen.has(payment.method)) {
      context.addIssue({
        code: 'custom',
        path: ['payments', index, 'method'],
        message: 'لا يمكن تكرار وسيلة الدفع',
      });
    }
    seen.add(payment.method);
  });
});

export const quoteSaleInputSchema = z.object({
  branchId: positiveMysqlIntSchema.optional(),
  lines: z.array(saleLineSchema).min(1).max(100),
  discount: adjustmentSchema.optional(),
  tax: adjustmentSchema.optional(),
}).strict();

export type CompleteSaleInput = z.infer<typeof completeSaleSchema>;
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;
export type RefundInvoiceInput = z.infer<typeof refundInvoiceSchema>;
export type ReassignInvoiceLineInput = z.infer<typeof reassignInvoiceLineSchema>;
export type RecordInvoicePaymentInput = z.infer<typeof recordInvoicePaymentSchema>;
export type RefundQuoteInput = z.infer<typeof refundQuoteInputSchema>;
export type RefundQuote = z.infer<typeof refundQuoteSchema>;
export type QuoteSaleInput = z.infer<typeof quoteSaleInputSchema>;
