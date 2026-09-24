
import { z } from 'zod';

import {
  coercedMysqlIntSchema,
  paginationPageSchema,
  paginationPageSizeSchema,
  positiveMysqlIntSchema,
} from '../../../common/index.ts';
import {
  adjustmentKindSchema,
  commissionRuleSchema,
  exactMoneySchema,
  invoiceNumberSchema,
  isoDateTimeSchema,
  paymentBreakdownSchema,
  paymentMethodSchema,
  paymentSchema,
  percentageAmount,
  percentageSchema,
  positiveMoneySchema,
  saleItemTypeSchema,
  toCents,
} from './sale-commands.ts';

export const invoiceTotalsSchema = z.object({
  subtotal: positiveMoneySchema,
  discountAmount: exactMoneySchema,
  taxAmount: exactMoneySchema,
  total: exactMoneySchema,
  paymentTotal: exactMoneySchema,
  amountPaid: exactMoneySchema,
  creditedAmount: exactMoneySchema,
  balanceDue: exactMoneySchema,
  settlementStatus: z.enum(['settled', 'open']),
}).strict().superRefine((value, context) => {
  const expected = toCents(value.subtotal) - toCents(value.discountAmount)
    + toCents(value.taxAmount);
  if (expected !== toCents(value.total)) {
    context.addIssue({ code: 'custom', path: ['total'], message: 'إجمالي الفاتورة غير متسق' });
  }
  const total = toCents(value.total);
  const paid = toCents(value.amountPaid);
  const credited = toCents(value.creditedAmount);
  const balance = total - credited - paid;
  if (toCents(value.paymentTotal) < paid || balance < BigInt(0)
    || toCents(value.balanceDue) !== balance
    || value.settlementStatus !== (balance === BigInt(0) ? 'settled' : 'open')) {
    context.addIssue({ code: 'custom', path: ['amountPaid'], message: 'حالة سداد الفاتورة غير متسقة' });
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
  commissionPercent: percentageSchema.optional(),
}).strict().superRefine((value, context) => {
  if (toCents(value.lineTotal) !== toCents(value.unitPrice) * BigInt(value.quantity)) {
    context.addIssue({ code: 'custom', path: ['lineTotal'], message: 'إجمالي البند غير متسق' });
  }
});

const saleQuoteTotalsSchema = z.object({
  subtotal: positiveMoneySchema,
  discountAmount: exactMoneySchema,
  taxAmount: exactMoneySchema,
  total: exactMoneySchema,
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

const invoiceEmployeeSchema = z.object({
  id: positiveMysqlIntSchema,
  employeeCode: positiveMysqlIntSchema,
  name: z.string().min(1).max(255),
}).strict();

const invoiceLineReassignmentSchema = z.object({
  id: positiveMysqlIntSchema,
  fromEmployee: invoiceEmployeeSchema,
  toEmployee: invoiceEmployeeSchema,
  reason: z.string().min(1).max(1000),
  actingAccount: z.object({
    id: positiveMysqlIntSchema,
    username: z.string().min(1).max(255),
  }).strict(),
  createdAt: isoDateTimeSchema,
}).strict();

const invoiceLineSchema = z.object({
  id: positiveMysqlIntSchema,
  lineNumber: positiveMysqlIntSchema,
  itemType: saleItemTypeSchema,
  sourceId: positiveMysqlIntSchema,
  name: z.string().min(1).max(255),
  quantity: positiveMysqlIntSchema,
  unitPrice: positiveMoneySchema,
  lineTotal: positiveMoneySchema,
  /** The employee who earned this line's commission, when one exists. */
  employee: invoiceEmployeeSchema.nullable(),
  originalEmployee: invoiceEmployeeSchema.nullable(),
  reassignments: z.array(invoiceLineReassignmentSchema),
  commissionRule: commissionRuleSchema,
  commissionRate: percentageSchema,
  commissionAmount: exactMoneySchema,
  productCostBasis: exactMoneySchema.nullable(),
  refundedQuantity: z.number().int().min(0),
  refundableQuantity: z.number().int().min(0),
  /** One number per sold service unit; products never enter a service queue. */
  queueNumbers: z.array(positiveMysqlIntSchema).max(100),
  /** Current performer of each sold service unit. Omitted by older clients. */
  queueAssignments: z.array(z.object({
    id: positiveMysqlIntSchema,
    queueNumber: positiveMysqlIntSchema,
    employee: invoiceEmployeeSchema,
  }).strict()).max(100).optional(),
}).strict().superRefine((value, context) => {
  if (value.queueAssignments && (value.queueAssignments.length !== value.queueNumbers.length
    || value.queueAssignments.some((entry, index) => entry.queueNumber !== value.queueNumbers[index]))) {
    context.addIssue({ code: 'custom', path: ['queueAssignments'], message: 'Queue assignments do not match the sold service units' });
  }
  if (value.itemType === 'service' && value.employee === null) {
    context.addIssue({ code: 'custom', path: ['employee'], message: 'الخدمة يجب أن تحمل الموظف المنفّذ' });
  }
  if (value.itemType === 'service'
    && (value.queueNumbers.length !== value.quantity
      || new Set(value.queueNumbers).size !== value.queueNumbers.length)) {
    context.addIssue({ code: 'custom', path: ['queueNumbers'], message: 'أرقام انتظار الخدمة غير متسقة' });
  }
  if (value.itemType === 'product' && value.queueNumbers.length !== 0) {
    context.addIssue({ code: 'custom', path: ['queueNumbers'], message: 'المنتج لا يحمل رقم انتظار خدمة' });
  }
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
  if (value.itemType === 'product') {
    if (value.commissionRule === 'none'
      && (toCents(value.commissionRate) !== BigInt(0)
        || toCents(value.commissionAmount) !== BigInt(0))) {
      context.addIssue({ code: 'custom', path: ['commissionRule'], message: 'المنتج بلا عمولة يجب أن يحمل قيم عمولة صفرية' });
    }
    if (value.commissionRule !== 'none' && value.employee === null) {
      context.addIssue({ code: 'custom', path: ['employee'], message: 'المنتج ذو العمولة يجب أن يحمل الموظف المستحق' });
    }
    if (value.commissionRule !== 'none'
      && toCents(value.commissionAmount) !== percentageAmount(value.lineTotal, value.commissionRate)) {
      context.addIssue({ code: 'custom', path: ['commissionAmount'], message: 'عمولة المنتج غير متسقة' });
    }
  }
  if (value.itemType === 'service'
    && toCents(value.commissionAmount) !== percentageAmount(value.lineTotal, value.commissionRate)) {
    context.addIssue({ code: 'custom', path: ['commissionAmount'], message: 'عمولة الخدمة غير متسقة' });
  }
});

/**
 * `refundedAmount` and `refundableAmount` describe **this payment row**, not the
 * invoice. A refund may be handed back on a method the client never used, or for
 * more than what is left on the matching payment; either way it reverses no
 * particular payment and leaves these two untouched. So a fully refunded invoice
 * can still show a payment with money left "refundable" here. What the invoice
 * still owes back is governed by the line quantities and by `eligibility`.
 */
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
  invoiceNumber: invoiceNumberSchema,
  status: z.enum(['completed', 'partially_refunded', 'refunded', 'voided']),
  // A customer sale, or internal trade moving stock to another branch.
  kind: z.enum(['sale', 'branch_transfer']),
  branchId: positiveMysqlIntSchema,
  cashierSessionId: positiveMysqlIntSchema,
  // Either half may be missing, but never both: a client is identified by a
  // name or by a number, and an invoice must say who it was sold to.
  client: z.object({
    id: positiveMysqlIntSchema,
    name: z.string().min(1).max(255).nullable(),
    phone: z.string().regex(/^01[0125]\d{8}$/).nullable(),
  }).strict().superRefine((value, context) => {
    if (value.name === null && value.phone === null) {
      context.addIssue({ code: 'custom', message: 'الفاتورة يجب أن تحمل اسم العميل أو رقم هاتفه' });
    }
  }),
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
  payments: z.array(storedInvoicePaymentSchema),
  reversals: z.array(invoiceReversalSchema),
  eligibility: z.object({ canVoid: z.boolean(), canRefund: z.boolean() }).strict(),
  soldAt: isoDateTimeSchema,
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
    allowPartialPayment: value.lines.every((line) => line.itemType === 'product'),
    allowRepeatedMethods: true,
  });
  const storedPaymentTotal = value.payments.reduce((sum, payment) => sum + toCents(payment.amount), BigInt(0));
  if (storedPaymentTotal !== toCents(value.totals.paymentTotal)) {
    context.addIssue({ code: 'custom', path: ['totals', 'paymentTotal'], message: 'إجمالي المدفوعات لا يطابق سجلات الدفع' });
  }
  if (!breakdown.success) {
    context.addIssue({
      code: 'custom',
      path: ['payments'],
      message: 'تفاصيل المدفوعات غير متسقة مع إجمالي الفاتورة',
    });
  }
  if (value.lines.some((line) => line.itemType === 'service')
    && value.totals.settlementStatus !== 'settled') {
    context.addIssue({
      code: 'custom', path: ['totals', 'settlementStatus'], message: 'فواتير الخدمات يجب سدادها بالكامل',
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

const cairoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح').refine((value) => {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = value.split('-').map(Number);
  if (year < 1000 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'التاريخ غير صالح');

export const invoiceHistoryQuerySchema = z.object({
  page: paginationPageSchema.default(1),
  pageSize: paginationPageSizeSchema.default(20),
  branchId: coercedMysqlIntSchema.optional(),
  clientId: coercedMysqlIntSchema.optional(),
  search: z.string().trim().min(1).max(255).optional(),
  status: z.enum(['completed', 'partially_refunded', 'refunded', 'voided']).optional(),
  settlementStatus: z.enum(['settled', 'open']).optional(),
  fromDate: cairoDateSchema.optional(),
  toDate: cairoDateSchema.optional(),
  employeeId: coercedMysqlIntSchema.optional(),
  orderBy: z.enum(['soldAt', 'total', 'balanceDue', 'invoiceNumber']).default('soldAt'),
  orderDir: z.enum(['asc', 'desc']).default('desc'),
}).strict().refine((value) => !value.fromDate || !value.toDate || value.fromDate <= value.toDate, {
  path: ['toDate'], message: 'نهاية الفترة يجب ألا تسبق بدايتها',
});

export const invoiceParamsSchema = z.object({
  invoiceId: coercedMysqlIntSchema,
}).strict();

export const invoiceBranchQuerySchema = z.object({
  branchId: coercedMysqlIntSchema.optional(),
}).strict();

/**
 * The distinct employees who performed the invoice's services, in line order.
 * Empty on a product-only invoice.
 */
const invoiceEmployeesSchema = z.array(z.object({
  id: positiveMysqlIntSchema,
  name: z.string().min(1).max(255),
}).strict()).max(100).superRefine((value, context) => {
  const seen = new Set<number>();
  value.forEach((employee, index) => {
    if (seen.has(employee.id)) {
      context.addIssue({ code: 'custom', path: [index, 'id'], message: 'لا يمكن تكرار الموظف' });
    }
    seen.add(employee.id);
  });
});

export const invoiceHistoryItemSchema = z.object({
  id: positiveMysqlIntSchema,
  invoiceNumber: invoiceNumberSchema,
  status: z.enum(['completed', 'partially_refunded', 'refunded', 'voided']),
  total: exactMoneySchema,
  amountPaid: exactMoneySchema,
  balanceDue: exactMoneySchema,
  settlementStatus: z.enum(['settled', 'open']),
  // The phone travels with the row: a client recorded without a name is
  // otherwise unidentifiable in the invoice list.
  client: z.object({
    id: positiveMysqlIntSchema,
    name: z.string().min(1).max(255).nullable(),
    phone: z.string().regex(/^01[0125]\d{8}$/).nullable(),
  }).strict(),
  employees: invoiceEmployeesSchema,
  soldAt: isoDateTimeSchema,
}).strict();

export const clientVisitSummarySchema = z.object({
  id: positiveMysqlIntSchema,
  invoiceNumber: invoiceNumberSchema,
  status: z.enum(['completed', 'partially_refunded', 'refunded', 'voided']),
  total: exactMoneySchema,
  employees: invoiceEmployeesSchema,
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
    'REASSIGN_PAYROLL_FINALIZED',
    'REASSIGN_LINE_NOT_SERVICE',
    'REASSIGN_SAME_EMPLOYEE',
    'INVOICE_NOT_REASSIGNABLE',
    'PAYMENT_EXCEEDS_BALANCE',
    'PARTIAL_PAYMENT_NOT_ALLOWED_WITH_SERVICES',
    'INVOICE_NOT_VOIDABLE_WHEN_PARTIALLY_PAID',
  ]),
  message: z.string().min(1),
  field: z.string().min(1).optional(),
}).strict();

export const saleFixtures = {
  serviceSaleDraft: {
    branchId: 2,
    clientId: 5,
    sellerEmployeeId: 9,
    cashierSessionId: 13,
    idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 8 }],
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
    kind: 'sale',
    branchId: 2,
    cashierSessionId: 13,
    client: { id: 5, name: 'منى أحمد', phone: '01012345678' },
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
      employee: { id: 8, employeeCode: 1008, name: 'سارة علي' },
      originalEmployee: { id: 8, employeeCode: 1008, name: 'سارة علي' },
      reassignments: [],
      commissionRule: 'employee_override',
      commissionRate: '15.00',
      commissionAmount: '30.00',
      productCostBasis: null,
      refundedQuantity: 0,
      refundableQuantity: 1,
      queueNumbers: [1],
    }],
    discount: { kind: 'percentage', value: '10.00', amount: '20.00' },
    tax: { kind: 'fixed', value: '5.00', amount: '5.00' },
    totals: {
      subtotal: '200.00',
      discountAmount: '20.00',
      taxAmount: '5.00',
      total: '185.00',
      paymentTotal: '185.00',
      amountPaid: '185.00',
      creditedAmount: '0.00',
      balanceDue: '0.00',
      settlementStatus: 'settled',
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

export type BranchCashierRosterQuery = z.infer<typeof branchCashierRosterQuerySchema>;
export type BranchCashierRosterItem = z.infer<typeof branchCashierRosterItemSchema>;
export type ReplaceBranchCashierRosterInput = z.infer<typeof replaceBranchCashierRosterSchema>;
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
