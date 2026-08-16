import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
  positiveMysqlIntSchema,
} from '../../../common/index.js';

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

const normalizeDecimal = (value: string) => {
  const [whole = '', fraction = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
};

const exactMoneySchema = z.string()
  .regex(/^\d{1,12}(?:\.\d{1,2})?$/, 'يجب إدخال مبلغ صحيح بدقة قرش واحد')
  .transform(normalizeDecimal);

const positiveMoneySchema = exactMoneySchema.refine(
  (value) => value !== '0.00',
  'يجب أن يكون المبلغ أكبر من صفر',
);

// Invoice lines use decimal(12,2): at most ten whole digits plus two decimals.
const serviceUnitPriceSchema = z.string()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'يجب إدخال سعر صحيح بدقة قرش واحد')
  .transform(normalizeDecimal)
  .refine((value) => value !== '0.00', 'يجب أن يكون السعر أكبر من صفر');

const percentageSchema = z.string()
  .regex(/^\d{1,3}(?:\.\d{1,2})?$/, 'يجب إدخال نسبة صحيحة')
  .transform(normalizeDecimal)
  .refine((value) => Number(value) <= 100, 'يجب ألا تتجاوز النسبة 100');

const toCents = (value: string) => {
  const [whole = '0', fraction = '00'] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

const percentageAmount = (base: string, percentage: string) => {
  const numerator = toCents(base) * toCents(percentage);
  return (numerator + BigInt(5000)) / BigInt(10000);
};

export const paymentMethodSchema = z.enum(['cash', 'visa', 'instapay', 'vodafone_cash']);
export const saleItemTypeSchema = z.enum(['service', 'product']);
export const adjustmentKindSchema = z.enum(['percentage', 'fixed']);
export const commissionRuleSchema = z.enum(['service_default', 'employee_override', 'none']);

const adjustmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percentage'), value: percentageSchema }).strict(),
  z.object({ kind: z.literal('fixed'), value: exactMoneySchema }).strict(),
]);

const saleLineSchema = z.discriminatedUnion('itemType', [
  z.object({
    itemType: z.literal('service'),
    serviceId: positiveMysqlIntSchema,
    quantity: positiveMysqlIntSchema,
    unitPrice: serviceUnitPriceSchema,
  }).strict(),
  z.object({
    itemType: z.literal('product'),
    productId: positiveMysqlIntSchema,
    quantity: positiveMysqlIntSchema,
  }).strict(),
]);

const paymentSchema = z.object({
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
  payments: z.array(z.object({
    method: paymentMethodSchema,
    refundableAmount: exactMoneySchema,
  }).strict()),
}).strict();

export const paymentBreakdownSchema = z.object({
  total: positiveMoneySchema,
  payments: z.array(paymentSchema).min(1).max(paymentMethodSchema.options.length),
}).strict().superRefine((value, context) => {
  const paymentTotal = value.payments.reduce(
    (sum, payment) => sum + toCents(payment.amount),
    BigInt(0),
  );
  if (paymentTotal !== toCents(value.total)) {
    context.addIssue({
      code: 'custom',
      path: ['payments'],
      message: 'مجموع المدفوعات لا يساوي إجمالي الفاتورة',
    });
  }
  const methods = value.payments.map(({ method }) => method);
  if (new Set(methods).size !== methods.length) {
    context.addIssue({ code: 'custom', path: ['payments'], message: 'لا يمكن تكرار وسيلة الدفع' });
  }
});

export const completeSaleSchema = z.object({
  branchId: positiveMysqlIntSchema.optional(),
  clientId: positiveMysqlIntSchema,
  assignedEmployeeId: positiveMysqlIntSchema.optional(),
  sellerEmployeeId: positiveMysqlIntSchema,
  cashierSessionId: positiveMysqlIntSchema,
  idempotencyKey: z.string().uuid(),
  lines: z.array(saleLineSchema).min(1).max(100),
  discount: adjustmentSchema.optional(),
  tax: adjustmentSchema.optional(),
  payments: z.array(paymentSchema).min(1).max(paymentMethodSchema.options.length),
}).strict().superRefine((value, context) => {
  const hasService = value.lines.some((line) => line.itemType === 'service');
  if (hasService && value.assignedEmployeeId === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['assignedEmployeeId'],
      message: 'يجب اختيار موظف حاضر لفاتورة تحتوي على خدمة',
    });
  }
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
}).transform((value) => {
  if (value.lines.some((line) => line.itemType === 'service')
    || value.assignedEmployeeId === undefined) return value;
  const productOnly = { ...value };
  Reflect.deleteProperty(productOnly, 'assignedEmployeeId');
  return productOnly;
});

export const quoteSaleInputSchema = z.object({
  branchId: positiveMysqlIntSchema.optional(),
  lines: z.array(saleLineSchema).min(1).max(100),
  discount: adjustmentSchema.optional(),
  tax: adjustmentSchema.optional(),
}).strict();

export const invoiceTotalsSchema = z.object({
  subtotal: positiveMoneySchema,
  discountAmount: exactMoneySchema,
  taxAmount: exactMoneySchema,
  total: positiveMoneySchema,
  paymentTotal: positiveMoneySchema,
}).strict().superRefine((value, context) => {
  const expected = toCents(value.subtotal) - toCents(value.discountAmount)
    + toCents(value.taxAmount);
  if (expected !== toCents(value.total)) {
    context.addIssue({ code: 'custom', path: ['total'], message: 'إجمالي الفاتورة غير متسق' });
  }
  if (toCents(value.paymentTotal) !== toCents(value.total)) {
    context.addIssue({ code: 'custom', path: ['paymentTotal'], message: 'مجموع المدفوعات لا يساوي إجمالي الفاتورة' });
  }
});

const storedAdjustmentSchema = z.object({
  kind: adjustmentKindSchema,
  value: exactMoneySchema,
  amount: exactMoneySchema,
}).strict().superRefine((value, context) => {
  if (value.kind === 'percentage' && Number(value.value) > 100) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'يجب ألا تتجاوز النسبة 100' });
  }
  if (value.kind === 'fixed' && toCents(value.value) !== toCents(value.amount)) {
    context.addIssue({ code: 'custom', path: ['amount'], message: 'قيمة التعديل الثابت غير متسقة' });
  }
});

const quoteLineSchema = z.object({
  itemType: saleItemTypeSchema,
  sourceId: positiveMysqlIntSchema,
  name: z.string().min(1).max(255),
  quantity: positiveMysqlIntSchema,
  unitPrice: positiveMoneySchema,
  lineTotal: positiveMoneySchema,
}).strict().superRefine((value, context) => {
  if (toCents(value.lineTotal) !== toCents(value.unitPrice) * BigInt(value.quantity)) {
    context.addIssue({ code: 'custom', path: ['lineTotal'], message: 'إجمالي البند غير متسق' });
  }
});

const saleQuoteTotalsSchema = z.object({
  subtotal: positiveMoneySchema,
  discountAmount: exactMoneySchema,
  taxAmount: exactMoneySchema,
  total: positiveMoneySchema,
}).strict().superRefine((value, context) => {
  const expected = toCents(value.subtotal) - toCents(value.discountAmount)
    + toCents(value.taxAmount);
  if (expected !== toCents(value.total)) {
    context.addIssue({ code: 'custom', path: ['total'], message: 'إجمالي الفاتورة غير متسق' });
  }
});

const validateAdjustment = (
  adjustment: z.infer<typeof storedAdjustmentSchema> | null,
  storedAmount: string,
  subtotal: string,
  path: 'discount' | 'tax',
  context: z.RefinementCtx,
) => {
  if (adjustment === null) {
    if (toCents(storedAmount) !== BigInt(0)) {
      context.addIssue({ code: 'custom', path: [path], message: 'قيمة التعديل غير متسقة' });
    }
    return;
  }
  const expected = adjustment.kind === 'fixed'
    ? toCents(adjustment.value)
    : percentageAmount(subtotal, adjustment.value);
  if (toCents(adjustment.amount) !== expected || toCents(storedAmount) !== expected) {
    context.addIssue({ code: 'custom', path: [path, 'amount'], message: 'قيمة التعديل غير متسقة' });
  }
};

export const saleQuoteSchema = z.object({
  lines: z.array(quoteLineSchema).min(1),
  discount: storedAdjustmentSchema.nullable(),
  tax: storedAdjustmentSchema.nullable(),
  totals: saleQuoteTotalsSchema,
}).strict().superRefine((value, context) => {
  const lineSubtotal = value.lines.reduce(
    (sum, line) => sum + toCents(line.lineTotal),
    BigInt(0),
  );
  if (lineSubtotal !== toCents(value.totals.subtotal)) {
    context.addIssue({ code: 'custom', path: ['totals', 'subtotal'], message: 'مجموع البنود لا يساوي المجموع الفرعي' });
  }
  validateAdjustment(
    value.discount,
    value.totals.discountAmount,
    value.totals.subtotal,
    'discount',
    context,
  );
  validateAdjustment(value.tax, value.totals.taxAmount, value.totals.subtotal, 'tax', context);
});

const invoiceLineSchema = z.object({
  id: positiveMysqlIntSchema,
  lineNumber: positiveMysqlIntSchema,
  itemType: saleItemTypeSchema,
  sourceId: positiveMysqlIntSchema,
  name: z.string().min(1).max(255),
  quantity: positiveMysqlIntSchema,
  unitPrice: positiveMoneySchema,
  lineTotal: positiveMoneySchema,
  commissionRule: commissionRuleSchema,
  commissionRate: percentageSchema,
  commissionAmount: exactMoneySchema,
  productCostBasis: exactMoneySchema.nullable(),
  refundedQuantity: z.number().int().min(0),
  refundableQuantity: z.number().int().min(0),
}).strict().superRefine((value, context) => {
  if (value.refundedQuantity + value.refundableQuantity !== value.quantity) {
    context.addIssue({ code: 'custom', path: ['refundableQuantity'], message: 'كميات الاسترداد غير متسقة' });
  }
  if (toCents(value.lineTotal) !== toCents(value.unitPrice) * BigInt(value.quantity)) {
    context.addIssue({ code: 'custom', path: ['lineTotal'], message: 'إجمالي البند غير متسق' });
  }
  if (value.itemType === 'service' && value.productCostBasis !== null) {
    context.addIssue({ code: 'custom', path: ['productCostBasis'], message: 'الخدمة ليس لها تكلفة منتج' });
  }
  if (value.itemType === 'service' && value.commissionRule === 'none') {
    context.addIssue({ code: 'custom', path: ['commissionRule'], message: 'الخدمة تتطلب قاعدة عمولة' });
  }
  if (value.itemType === 'service'
    && toCents(value.commissionAmount) !== percentageAmount(value.lineTotal, value.commissionRate)) {
    context.addIssue({ code: 'custom', path: ['commissionAmount'], message: 'عمولة الخدمة غير متسقة' });
  }
  if (value.itemType === 'product' && (value.productCostBasis === null || value.commissionRule !== 'none')) {
    context.addIssue({ code: 'custom', path: ['commissionRule'], message: 'المنتج لا يحقق عمولة' });
  }
  if (value.itemType === 'product'
    && (value.commissionRate !== '0.00' || value.commissionAmount !== '0.00')) {
    context.addIssue({ code: 'custom', path: ['commissionAmount'], message: 'المنتج لا يحقق عمولة' });
  }
});

const storedInvoicePaymentSchema = paymentSchema.extend({
  refundedAmount: exactMoneySchema,
  refundableAmount: exactMoneySchema,
}).strict().superRefine((value, context) => {
  if (toCents(value.refundedAmount) + toCents(value.refundableAmount) !== toCents(value.amount)) {
    context.addIssue({ code: 'custom', path: ['refundableAmount'], message: 'مبالغ الاسترداد غير متسقة' });
  }
});

export const invoiceReversalSchema = z.object({
  id: positiveMysqlIntSchema,
  type: z.enum(['void', 'refund']),
  reason: z.string().min(1).max(1000),
  actingAccount: z.object({
    id: positiveMysqlIntSchema,
    username: z.string().min(1).max(255),
  }).strict(),
  approvingAccount: z.object({
    id: positiveMysqlIntSchema,
    username: z.string().min(1).max(255),
  }).strict().nullable(),
  lines: z.array(z.object({
    invoiceLineId: positiveMysqlIntSchema,
    lineNumber: positiveMysqlIntSchema,
    itemType: saleItemTypeSchema,
    name: z.string().min(1).max(255),
    quantity: positiveMysqlIntSchema,
    grossAmount: positiveMoneySchema,
    discountAmount: exactMoneySchema,
    taxAmount: exactMoneySchema,
    total: exactMoneySchema,
  }).strict()).min(1),
  payments: z.array(paymentSchema).max(paymentMethodSchema.options.length),
  totals: z.object({
    grossAmount: positiveMoneySchema,
    discountAmount: exactMoneySchema,
    taxAmount: exactMoneySchema,
    total: exactMoneySchema,
  }).strict(),
  createdAt: isoDateTimeSchema,
}).strict();

export const invoiceSchema = z.object({
  id: positiveMysqlIntSchema,
  invoiceNumber: z.string().regex(/^INV-\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}-\d+$/),
  status: z.enum(['completed', 'partially_refunded', 'refunded', 'voided']),
  branchId: positiveMysqlIntSchema,
  cashierSessionId: positiveMysqlIntSchema,
  // Either half may be missing: a client is identified by a name or by a number.
  client: z.object({
    id: positiveMysqlIntSchema,
    name: z.string().min(1).max(255).nullable(),
    phone: z.string().regex(/^01[0125]\d{8}$/).nullable(),
  }).strict(),
  assignedEmployee: z.object({
    id: positiveMysqlIntSchema,
    employeeCode: positiveMysqlIntSchema,
    name: z.string().min(1).max(255),
  }).strict().nullable(),
  seller: z.object({
    id: positiveMysqlIntSchema,
    employeeCode: positiveMysqlIntSchema,
    name: z.string().min(1).max(255),
  }).strict().nullable(),
  authorizedBy: z.object({
    accountId: positiveMysqlIntSchema,
    username: z.string().min(1).max(255),
  }).strict(),
  lines: z.array(invoiceLineSchema).min(1),
  discount: storedAdjustmentSchema.nullable(),
  tax: storedAdjustmentSchema.nullable(),
  totals: invoiceTotalsSchema,
  payments: z.array(storedInvoicePaymentSchema).min(1).max(paymentMethodSchema.options.length),
  reversals: z.array(invoiceReversalSchema),
  eligibility: z.object({ canVoid: z.boolean(), canRefund: z.boolean() }).strict(),
  soldAt: isoDateTimeSchema,
}).strict().superRefine((value, context) => {
  const hasService = value.lines.some((line) => line.itemType === 'service');
  if (hasService && value.assignedEmployee === null) {
    context.addIssue({
      code: 'custom',
      path: ['assignedEmployee'],
      message: 'ربط الموظف لا يتوافق مع بنود الفاتورة',
    });
  }
  const lineSubtotal = value.lines.reduce(
    (sum, line) => sum + toCents(line.lineTotal),
    BigInt(0),
  );
  if (lineSubtotal !== toCents(value.totals.subtotal)) {
    context.addIssue({ code: 'custom', path: ['totals', 'subtotal'], message: 'مجموع البنود لا يساوي المجموع الفرعي' });
  }

  validateAdjustment(
    value.discount,
    value.totals.discountAmount,
    value.totals.subtotal,
    'discount',
    context,
  );
  validateAdjustment(
    value.tax,
    value.totals.taxAmount,
    value.totals.subtotal,
    'tax',
    context,
  );

  const breakdown = paymentBreakdownSchema.safeParse({
    total: value.totals.total,
    payments: value.payments.map(({ method, amount }) => ({ method, amount })),
  });
  if (!breakdown.success) {
    context.addIssue({
      code: 'custom',
      path: ['payments'],
      message: 'تفاصيل المدفوعات غير متسقة مع إجمالي الفاتورة',
    });
  }
});

export const branchCashierRosterQuerySchema = z.object({
  branchId: coercedMysqlIntSchema.optional(),
}).strict();

export const branchCashierRosterItemSchema = z.object({
  id: positiveMysqlIntSchema,
  employeeCode: positiveMysqlIntSchema,
  fullName: z.string().min(1).max(255),
}).strict();

export const replaceBranchCashierRosterSchema = z.object({
  employeeIds: z.array(positiveMysqlIntSchema).max(100),
}).strict().superRefine((value, context) => {
  const seen = new Set<number>();
  value.employeeIds.forEach((employeeId, index) => {
    if (seen.has(employeeId)) {
      context.addIssue({
        code: 'custom',
        path: ['employeeIds', index],
        message: 'لا يمكن تكرار الموظف في الوردية',
      });
    }
    seen.add(employeeId);
  });
});

export const clientVisitHistoryQuerySchema = z.object({
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  branchId: coercedMysqlIntSchema.optional(),
}).strict();

export const invoiceHistoryQuerySchema = z.object({
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  branchId: coercedMysqlIntSchema.optional(),
  search: z.string().trim().min(1).max(255).optional(),
}).strict();

export const invoiceParamsSchema = z.object({
  invoiceId: coercedMysqlIntSchema,
}).strict();

export const invoiceHistoryItemSchema = z.object({
  id: positiveMysqlIntSchema,
  invoiceNumber: z.string().regex(/^INV-\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}-\d+$/),
  status: z.enum(['completed', 'partially_refunded', 'refunded', 'voided']),
  total: positiveMoneySchema,
  client: z.object({
    id: positiveMysqlIntSchema,
    name: z.string().min(1).max(255).nullable(),
  }).strict(),
  assignedEmployee: z.object({
    id: positiveMysqlIntSchema,
    name: z.string().min(1).max(255),
  }).strict().nullable(),
  soldAt: isoDateTimeSchema,
}).strict();

export const clientVisitSummarySchema = z.object({
  id: positiveMysqlIntSchema,
  invoiceNumber: z.string().regex(/^INV-\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}-\d+$/),
  status: z.enum(['completed', 'partially_refunded', 'refunded', 'voided']),
  total: positiveMoneySchema,
  assignedEmployee: z.object({
    id: positiveMysqlIntSchema,
    name: z.string().min(1).max(255),
  }).strict().nullable(),
  soldAt: isoDateTimeSchema,
}).strict();

export const saleErrorSchema = z.object({
  code: z.enum([
    'SALE_VALIDATION_FAILED',
    'CLIENT_NOT_FOUND',
    'EMPLOYEE_NOT_ASSIGNABLE',
    'SELLER_NOT_ON_ROSTER',
    'CASHIER_SESSION_NOT_OPEN',
    'SERVICE_UNAVAILABLE',
    'PRICE_CHANGED',
    'PRODUCT_UNAVAILABLE',
    'INSUFFICIENT_STOCK',
    'PAYMENT_TOTAL_MISMATCH',
    'IDEMPOTENCY_CONFLICT',
    'INVOICE_NOT_FOUND',
    'INVOICE_NOT_REVERSIBLE',
    'VOID_DATE_EXPIRED',
    'REFUND_QUANTITY_EXCEEDED',
    'REFUND_PAYMENT_MISMATCH',
    'REFUND_PAYMENT_EXCEEDED',
  ]),
  message: z.string().min(1),
  field: z.string().min(1).optional(),
}).strict();

export const saleFixtures = {
  serviceSaleDraft: {
    branchId: 2,
    clientId: 5,
    assignedEmployeeId: 8,
    sellerEmployeeId: 9,
    cashierSessionId: 13,
    idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00' }],
    discount: { kind: 'percentage', value: '10.00' },
    tax: { kind: 'fixed', value: '5.00' },
    payments: [
      { method: 'cash', amount: '100.00' },
      { method: 'visa', amount: '85.00' },
    ],
  },
  completedInvoice: {
    id: 44,
    invoiceNumber: 'INV-2026.08.03-14.35-17',
    status: 'completed',
    branchId: 2,
    cashierSessionId: 13,
    client: { id: 5, name: 'منى أحمد', phone: '01012345678' },
    assignedEmployee: { id: 8, employeeCode: 1008, name: 'سارة علي' },
    seller: { id: 9, employeeCode: 1009, name: 'أحمد جمال' },
    authorizedBy: { accountId: 3, username: 'cashier.one' },
    lines: [{
      id: 81,
      lineNumber: 1,
      itemType: 'service',
      sourceId: 21,
      name: 'صبغة شعر',
      quantity: 1,
      unitPrice: '200.00',
      lineTotal: '200.00',
      commissionRule: 'employee_override',
      commissionRate: '15.00',
      commissionAmount: '30.00',
      productCostBasis: null,
      refundedQuantity: 0,
      refundableQuantity: 1,
    }],
    discount: { kind: 'percentage', value: '10.00', amount: '20.00' },
    tax: { kind: 'fixed', value: '5.00', amount: '5.00' },
    totals: {
      subtotal: '200.00',
      discountAmount: '20.00',
      taxAmount: '5.00',
      total: '185.00',
      paymentTotal: '185.00',
    },
    payments: [{
      method: 'cash', amount: '185.00', refundedAmount: '0.00', refundableAmount: '185.00',
    }],
    reversals: [],
    eligibility: { canVoid: false, canRefund: true },
    soldAt: '2026-08-03T11:35:00.000Z',
  },
  errors: {
    validation: { code: 'SALE_VALIDATION_FAILED', message: 'بيانات البيع غير صالحة' },
    presence: { code: 'EMPLOYEE_NOT_ASSIGNABLE', message: 'الموظف غير مسجل الحضور حاليًا' },
    payment: { code: 'PAYMENT_TOTAL_MISMATCH', message: 'مجموع المدفوعات غير صحيح', field: 'payments' },
    retryConflict: { code: 'IDEMPOTENCY_CONFLICT', message: 'مفتاح العملية مستخدم لطلب مختلف' },
  },
} as const;

export type CompleteSaleInput = z.infer<typeof completeSaleSchema>;
export type BranchCashierRosterQuery = z.infer<typeof branchCashierRosterQuerySchema>;
export type BranchCashierRosterItem = z.infer<typeof branchCashierRosterItemSchema>;
export type ReplaceBranchCashierRosterInput = z.infer<typeof replaceBranchCashierRosterSchema>;
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;
export type RefundInvoiceInput = z.infer<typeof refundInvoiceSchema>;
export type RefundQuoteInput = z.infer<typeof refundQuoteInputSchema>;
export type RefundQuote = z.infer<typeof refundQuoteSchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type QuoteSaleInput = z.infer<typeof quoteSaleInputSchema>;
export type SaleQuote = z.infer<typeof saleQuoteSchema>;
export type InvoiceTotals = z.infer<typeof invoiceTotalsSchema>;
export type PaymentBreakdown = z.infer<typeof paymentBreakdownSchema>;
export type InvoiceDto = z.infer<typeof invoiceSchema>;
export type PublicInvoiceDto = Omit<InvoiceDto, 'lines'> & {
  lines: Array<Omit<InvoiceDto['lines'][number], 'productCostBasis'>>;
};
export type SaleError = z.infer<typeof saleErrorSchema>;
export type ClientVisitHistoryQuery = z.infer<typeof clientVisitHistoryQuerySchema>;
export type ClientVisitSummary = z.infer<typeof clientVisitSummarySchema>;
export type InvoiceHistoryQuery = z.infer<typeof invoiceHistoryQuerySchema>;
export type InvoiceHistoryItem = z.infer<typeof invoiceHistoryItemSchema>;
