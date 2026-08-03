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
  assignedEmployeeId: positiveMysqlIntSchema,
  cashierSessionId: positiveMysqlIntSchema,
  idempotencyKey: z.string().uuid(),
  lines: z.array(saleLineSchema).min(1).max(100),
  discount: adjustmentSchema.optional(),
  tax: adjustmentSchema.optional(),
  payments: z.array(paymentSchema).min(1).max(paymentMethodSchema.options.length),
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
}).strict().superRefine((value, context) => {
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

export const invoiceSchema = z.object({
  id: positiveMysqlIntSchema,
  invoiceNumber: z.string().regex(/^INV-\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}-\d+$/),
  status: z.enum(['completed', 'partially_refunded', 'refunded', 'voided']),
  branchId: positiveMysqlIntSchema,
  cashierSessionId: positiveMysqlIntSchema,
  client: z.object({
    id: positiveMysqlIntSchema,
    name: z.string().min(1).max(255),
    phone: z.string().regex(/^01[0125]\d{8}$/),
  }).strict(),
  assignedEmployee: z.object({
    id: positiveMysqlIntSchema,
    employeeCode: positiveMysqlIntSchema,
    name: z.string().min(1).max(255),
  }).strict(),
  authorizedBy: z.object({
    accountId: positiveMysqlIntSchema,
    username: z.string().min(1).max(255),
  }).strict(),
  lines: z.array(invoiceLineSchema).min(1),
  discount: storedAdjustmentSchema.nullable(),
  tax: storedAdjustmentSchema.nullable(),
  totals: invoiceTotalsSchema,
  payments: z.array(paymentSchema).min(1).max(paymentMethodSchema.options.length),
  soldAt: isoDateTimeSchema,
}).strict().superRefine((value, context) => {
  const lineSubtotal = value.lines.reduce(
    (sum, line) => sum + toCents(line.lineTotal),
    BigInt(0),
  );
  if (lineSubtotal !== toCents(value.totals.subtotal)) {
    context.addIssue({ code: 'custom', path: ['totals', 'subtotal'], message: 'مجموع البنود لا يساوي المجموع الفرعي' });
  }

  const validateAdjustment = (
    adjustment: typeof value.discount,
    storedAmount: string,
    path: 'discount' | 'tax',
  ) => {
    if (adjustment === null) {
      if (toCents(storedAmount) !== BigInt(0)) {
        context.addIssue({ code: 'custom', path: [path], message: 'قيمة التعديل غير متسقة' });
      }
      return;
    }
    const expected = adjustment.kind === 'fixed'
      ? toCents(adjustment.value)
      : percentageAmount(value.totals.subtotal, adjustment.value);
    if (toCents(adjustment.amount) !== expected || toCents(storedAmount) !== expected) {
      context.addIssue({ code: 'custom', path: [path, 'amount'], message: 'قيمة التعديل غير متسقة' });
    }
  };
  validateAdjustment(value.discount, value.totals.discountAmount, 'discount');
  validateAdjustment(value.tax, value.totals.taxAmount, 'tax');

  const breakdown = paymentBreakdownSchema.safeParse({
    total: value.totals.total,
    payments: value.payments,
  });
  if (!breakdown.success) {
    context.addIssue({
      code: 'custom',
      path: ['payments'],
      message: 'تفاصيل المدفوعات غير متسقة مع إجمالي الفاتورة',
    });
  }
});

export const saleErrorSchema = z.object({
  code: z.enum([
    'SALE_VALIDATION_FAILED',
    'CLIENT_NOT_FOUND',
    'EMPLOYEE_NOT_ASSIGNABLE',
    'CASHIER_SESSION_NOT_OPEN',
    'SERVICE_UNAVAILABLE',
    'PRODUCT_UNAVAILABLE',
    'PAYMENT_TOTAL_MISMATCH',
    'IDEMPOTENCY_CONFLICT',
  ]),
  message: z.string().min(1),
  field: z.string().min(1).optional(),
}).strict();

export const saleFixtures = {
  serviceSaleDraft: {
    branchId: 2,
    clientId: 5,
    assignedEmployeeId: 8,
    cashierSessionId: 13,
    idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
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
    payments: [{ method: 'cash', amount: '185.00' }],
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
export type InvoiceTotals = z.infer<typeof invoiceTotalsSchema>;
export type PaymentBreakdown = z.infer<typeof paymentBreakdownSchema>;
export type InvoiceDto = z.infer<typeof invoiceSchema>;
export type SaleError = z.infer<typeof saleErrorSchema>;
