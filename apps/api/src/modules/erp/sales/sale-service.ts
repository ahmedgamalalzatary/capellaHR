import type {
  ClientVisitHistoryQuery,
  ClientVisitSummary,
  CompleteSaleInput,
  InvoiceDto,
  InvoiceHistoryItem,
  InvoiceHistoryQuery,
  QuoteSaleInput,
  RefundInvoiceInput,
  RefundQuoteInput,
  SaleQuote,
  VoidInvoiceInput,
} from '@capella/contracts';
import type { createDatabase } from '@capella/database';
import { isDeepStrictEqual } from 'node:util';

import { ErpAssignmentError } from '../assignment/assignment-service.js';
import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import type { AssignableEmployee } from '../assignment/assignment-service.js';
import { allocateReversalAmounts, MoneyCalculationError } from './services/sale-calculations.js';

/**
 * A sale posted from inside the system rather than from a request: a transfer
 * between branches has no seller, because nobody sold anything and products
 * carry no commission. Every request-driven sale still names one.
 */
export type InternalCompleteSaleInput = Omit<CompleteSaleInput, 'sellerEmployeeId'>
  & { sellerEmployeeId?: number };

export type ResolvedCompleteSaleInput = InternalCompleteSaleInput & { branchId: number };

type Database = ReturnType<typeof createDatabase>;
/** The sale's own transaction, handed to work that must commit alongside it. */
export type SaleTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type CompleteSaleOperation = {
  input: ResolvedCompleteSaleInput;
  actingAccountId: number;
  actingAccountRole: 'admin' | 'cashier';
  invoiceNumber: string;
  soldAt: Date;
  assertEmployee?(context: unknown): Promise<AssignableEmployee>;
  /**
   * Product lines normally sell at the shelf price, which the request may never
   * override. A branch-to-branch transfer is the one sale priced at cost.
   */
  pricing?: 'selling' | 'cost';
  /** Internal trade between branches is a different document from a sale. */
  kind?: 'sale' | 'branch_transfer';
  /**
   * Work that must land with the invoice or not at all — the receiving branch's
   * side of a transfer. It runs inside the sale's own transaction.
   */
  afterInvoice?(transaction: SaleTransaction, invoice: InvoiceDto): Promise<void>;
};

type ReverseInvoiceOperationBase = {
  invoiceId: number;
  actingAccountId: number;
  actingAccountRole: 'admin' | 'cashier';
  reversedAt: Date;
};

export type ReverseInvoiceOperation = ReverseInvoiceOperationBase & (
  | { type: 'void'; input: VoidInvoiceInput & { branchId: number } }
  | { type: 'refund'; input: RefundInvoiceInput & { branchId: number } }
);

export interface SaleRepository {
  quote(branchId: number, input: QuoteSaleInput): Promise<SaleQuote>;
  findByIdempotencyKey(
    idempotencyKey: string,
    actor: { actingAccountId: number; actingAccountRole: 'admin' | 'cashier' },
  ): Promise<{
    input: ResolvedCompleteSaleInput;
    invoice: InvoiceDto;
  } | null>;
  complete(operation: CompleteSaleOperation): Promise<InvoiceDto>;
  reverse(operation: ReverseInvoiceOperation): Promise<InvoiceDto>;
  listClientVisits(
    branchId: number,
    clientId: number,
    query: ClientVisitHistoryQuery,
  ): Promise<{ items: ClientVisitSummary[]; total: number }>;
  listInvoices(
    branchId: number,
    query: InvoiceHistoryQuery,
  ): Promise<{ items: InvoiceHistoryItem[]; total: number }>;
  findInvoiceById(branchId: number, invoiceId: number): Promise<InvoiceDto | null>;
}

type SaleErrorCode =
  | 'SALE_VALIDATION_FAILED'
  | 'CLIENT_NOT_FOUND'
  | 'EMPLOYEE_NOT_ASSIGNABLE'
  | 'SELLER_NOT_ON_ROSTER'
  | 'CASHIER_SESSION_NOT_OPEN'
  | 'SERVICE_UNAVAILABLE'
  | 'PRICE_CHANGED'
  | 'PRODUCT_UNAVAILABLE'
  | 'INSUFFICIENT_STOCK'
  | 'PAYMENT_TOTAL_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVOICE_NOT_FOUND'
  | 'INVOICE_NOT_REVERSIBLE'
  | 'TRANSFER_NOT_REVERSIBLE'
  | 'VOID_DATE_EXPIRED'
  | 'REFUND_QUANTITY_EXCEEDED'
  | 'REFUND_PAYMENT_MISMATCH'
  | 'REFUND_PAYMENT_EXCEEDED';

const messages: Record<SaleErrorCode, string> = {
  SALE_VALIDATION_FAILED: 'بيانات البيع غير صالحة',
  CLIENT_NOT_FOUND: 'العميل غير موجود',
  EMPLOYEE_NOT_ASSIGNABLE: 'الموظف غير مسجل الحضور حاليًا',
  SELLER_NOT_ON_ROSTER: 'الكاشير المحدد غير مضاف لوردية هذا الفرع',
  CASHIER_SESSION_NOT_OPEN: 'جلسة الكاشير غير مفتوحة',
  SERVICE_UNAVAILABLE: 'إحدى الخدمات غير متاحة',
  PRICE_CHANGED: 'تغير سعر إحدى الخدمات؛ راجع السعر وأعد المحاولة',
  PRODUCT_UNAVAILABLE: 'إحدى المنتجات غير متاحة',
  INSUFFICIENT_STOCK: 'الكمية المتاحة من أحد المنتجات غير كافية',
  PAYMENT_TOTAL_MISMATCH: 'مجموع المدفوعات غير صحيح',
  IDEMPOTENCY_CONFLICT: 'مفتاح العملية مستخدم لطلب مختلف',
  INVOICE_NOT_FOUND: 'الفاتورة غير موجودة',
  INVOICE_NOT_REVERSIBLE: 'لا يمكن إلغاء أو استرداد هذه الفاتورة',
  TRANSFER_NOT_REVERSIBLE: 'فاتورة تحويل بين الفروع لا تُلغى ولا تُسترد؛ نفّذ تحويلاً معاكساً',
  VOID_DATE_EXPIRED: 'الإلغاء الكامل متاح في يوم البيع فقط',
  REFUND_QUANTITY_EXCEEDED: 'الكمية المستردة تتجاوز الكمية المتبقية',
  REFUND_PAYMENT_MISMATCH: 'توزيع مبلغ الاسترداد غير صحيح',
  REFUND_PAYMENT_EXCEEDED: 'مبلغ الاسترداد يتجاوز المتبقي لوسيلة الدفع',
};

export class SaleError extends Error {
  constructor(public readonly code: SaleErrorCode, message = messages[code]) {
    super(message);
    this.name = 'SaleError';
  }
}

export const createSaleService = (dependencies: {
  repository: SaleRepository;
  resolveBranchContext: ErpBranchContextResolver;
  assignment: {
    assertAssignable(
      actor: ErpAccountIdentity,
      input: { employeeId: number; branchId?: number | undefined },
      context?: unknown,
    ): Promise<AssignableEmployee>;
  };
  invoiceNumbers: {
    allocate(): Promise<{ invoiceNumber: string; allocatedAt: Date }>;
  };
}) => {
  const { repository, resolveBranchContext, assignment, invoiceNumbers } = dependencies;
  const resolveInput = async (actor: ErpAccountIdentity, input: InternalCompleteSaleInput) => {
    const { branchId, accountId } = await resolveBranchContext(actor, input.branchId);
    return { resolved: { ...input, branchId }, accountId };
  };

  const existingOrConflict = (
    existing: Awaited<ReturnType<SaleRepository['findByIdempotencyKey']>>,
    input: ResolvedCompleteSaleInput,
  ) => {
    if (!existing) return null;
    if (!isDeepStrictEqual(existing.input, input)) throw new SaleError('IDEMPOTENCY_CONFLICT');
    return existing.invoice;
  };

  return {
    async quote(actor: ErpAccountIdentity, input: QuoteSaleInput) {
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      return repository.quote(branchId, input);
    },

    async complete(
      actor: ErpAccountIdentity,
      input: InternalCompleteSaleInput,
      // Only a branch-to-branch transfer passes these: it prices at cost and
      // settles the receiving branch inside this sale's transaction.
      options?: Pick<CompleteSaleOperation, 'pricing' | 'kind' | 'afterInvoice'>,
    ) {
      const { resolved, accountId } = await resolveInput(actor, input);
      const existing = existingOrConflict(
        await repository.findByIdempotencyKey(input.idempotencyKey, {
          actingAccountId: accountId,
          actingAccountRole: actor.role,
        }),
        resolved,
      );
      if (existing) return existing;

      const number = await invoiceNumbers.allocate();
      try {
        const hasService = resolved.lines.some((line) => line.itemType === 'service');
        const invoice = await repository.complete({
          input: resolved,
          actingAccountId: accountId,
          actingAccountRole: actor.role,
          invoiceNumber: number.invoiceNumber,
          soldAt: number.allocatedAt,
          ...(options?.pricing ? { pricing: options.pricing } : {}),
          ...(options?.kind ? { kind: options.kind } : {}),
          ...(options?.afterInvoice ? { afterInvoice: options.afterInvoice } : {}),
          ...(hasService ? {
            assertEmployee: (context: unknown) => assignment.assertAssignable(actor, {
              employeeId: resolved.assignedEmployeeId!,
              branchId: resolved.branchId,
            }, context),
          } : {}),
        });
        return invoice;
      } catch (error) {
        if (error instanceof ErpAssignmentError) {
          throw new SaleError('EMPLOYEE_NOT_ASSIGNABLE');
        }
        throw error;
      }
    },

    async refund(actor: ErpAccountIdentity, invoiceId: number, input: RefundInvoiceInput) {
      const { branchId, accountId } = await resolveBranchContext(actor, input.branchId);
      const invoice = await repository.reverse({
        type: 'refund', invoiceId, input: { ...input, branchId },
        actingAccountId: accountId, actingAccountRole: actor.role, reversedAt: new Date(),
      });
      return invoice;
    },

    async quoteRefund(actor: ErpAccountIdentity, invoiceId: number, input: RefundQuoteInput) {
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      const invoice = await repository.findInvoiceById(branchId, invoiceId);
      if (!invoice) throw new SaleError('INVOICE_NOT_FOUND');
      if (!invoice.eligibility.canRefund) throw new SaleError('INVOICE_NOT_REVERSIBLE');
      try {
        const allocation = allocateReversalAmounts({
          lines: invoice.lines.map((line) => ({
            invoiceLineId: line.id,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            refundedQuantity: line.refundedQuantity,
          })),
          selected: input.lines,
          discountAmount: invoice.totals.discountAmount,
          taxAmount: invoice.totals.taxAmount,
        });
        return {
          lines: allocation.lines,
          totals: {
            grossAmount: allocation.grossAmount,
            discountAmount: allocation.discountAmount,
            taxAmount: allocation.taxAmount,
            total: allocation.total,
          },
          payments: allocation.total === '0.00' ? [] : invoice.payments
            .filter((payment) => payment.refundableAmount !== '0.00')
            .map((payment) => ({
              method: payment.method,
              refundableAmount: payment.refundableAmount,
            })),
        };
      } catch (error) {
        if (error instanceof MoneyCalculationError) {
          throw new SaleError('REFUND_QUANTITY_EXCEEDED');
        }
        throw error;
      }
    },

    async void(actor: ErpAccountIdentity, invoiceId: number, input: VoidInvoiceInput) {
      const { branchId, accountId } = await resolveBranchContext(actor, input.branchId);
      const invoice = await repository.reverse({
        type: 'void', invoiceId, input: { ...input, branchId },
        actingAccountId: accountId, actingAccountRole: actor.role, reversedAt: new Date(),
      });
      return invoice;
    },

    async listClientVisits(
      actor: ErpAccountIdentity,
      clientId: number,
      query: ClientVisitHistoryQuery,
    ) {
      const { branchId } = await resolveBranchContext(actor, query.branchId);
      return repository.listClientVisits(branchId, clientId, query);
    },

    async listInvoices(actor: ErpAccountIdentity, query: InvoiceHistoryQuery) {
      const { branchId } = await resolveBranchContext(actor, query.branchId);
      return repository.listInvoices(branchId, query);
    },

    async getInvoice(
      actor: ErpAccountIdentity,
      invoiceId: number,
      requestedBranchId?: number,
    ) {
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      const invoice = await repository.findInvoiceById(branchId, invoiceId);
      if (!invoice) throw new SaleError('INVOICE_NOT_FOUND');
      return invoice;
    },
  };
};

export type SaleService = ReturnType<typeof createSaleService>;
