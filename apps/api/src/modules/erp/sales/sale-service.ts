import type {
  ClientVisitHistoryQuery,
  ClientVisitSummary,
  CompleteSaleInput,
  InvoiceDto,
  PublicInvoiceDto,
  InvoiceHistoryItem,
  InvoiceHistoryQuery,
  QuoteSaleInput,
  SaleQuote,
} from '@capella/contracts';
import { isDeepStrictEqual } from 'node:util';

import { ErpAssignmentError } from '../assignment/assignment-service.js';
import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import type { AssignableEmployee } from '../assignment/assignment-service.js';

export type ResolvedCompleteSaleInput = CompleteSaleInput & { branchId: number };

export type CompleteSaleOperation = {
  input: ResolvedCompleteSaleInput;
  actingAccountId: number;
  actingAccountRole: 'admin' | 'cashier';
  actingEmployeeId: number | null;
  invoiceNumber: string;
  soldAt: Date;
  assertEmployee(context: unknown): Promise<AssignableEmployee>;
};

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
  | 'CASHIER_SESSION_NOT_OPEN'
  | 'SERVICE_UNAVAILABLE'
  | 'PRODUCT_UNAVAILABLE'
  | 'INSUFFICIENT_STOCK'
  | 'PAYMENT_TOTAL_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVOICE_NOT_FOUND';

const messages: Record<SaleErrorCode, string> = {
  SALE_VALIDATION_FAILED: 'بيانات البيع غير صالحة',
  CLIENT_NOT_FOUND: 'العميل غير موجود',
  EMPLOYEE_NOT_ASSIGNABLE: 'الموظف غير مسجل الحضور حاليًا',
  CASHIER_SESSION_NOT_OPEN: 'جلسة الكاشير غير مفتوحة',
  SERVICE_UNAVAILABLE: 'إحدى الخدمات غير متاحة',
  PRODUCT_UNAVAILABLE: 'إحدى المنتجات غير متاحة',
  INSUFFICIENT_STOCK: 'الكمية المتاحة من أحد المنتجات غير كافية',
  PAYMENT_TOTAL_MISMATCH: 'مجموع المدفوعات غير صحيح',
  IDEMPOTENCY_CONFLICT: 'مفتاح العملية مستخدم لطلب مختلف',
  INVOICE_NOT_FOUND: 'الفاتورة غير موجودة',
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
  const publicInvoice = (actor: ErpAccountIdentity, invoice: InvoiceDto): InvoiceDto | PublicInvoiceDto => {
    if (actor.role === 'admin') return invoice;
    return {
      ...invoice,
      lines: invoice.lines.map((line) => {
        const safeLine = { ...line };
        Reflect.deleteProperty(safeLine, 'productCostBasis');
        return safeLine;
      }),
    };
  };

  const resolveInput = async (actor: ErpAccountIdentity, input: CompleteSaleInput) => {
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

    async complete(actor: ErpAccountIdentity, input: CompleteSaleInput) {
      const { resolved, accountId } = await resolveInput(actor, input);
      const existing = existingOrConflict(
        await repository.findByIdempotencyKey(input.idempotencyKey, {
          actingAccountId: accountId,
          actingAccountRole: actor.role,
        }),
        resolved,
      );
      if (existing) return publicInvoice(actor, existing);

      const number = await invoiceNumbers.allocate();
      try {
        const invoice = await repository.complete({
          input: resolved,
          actingAccountId: accountId,
          actingAccountRole: actor.role,
          actingEmployeeId: actor.role === 'cashier' ? actor.employeeId : null,
          invoiceNumber: number.invoiceNumber,
          soldAt: number.allocatedAt,
          assertEmployee: (context) => assignment.assertAssignable(actor, {
            employeeId: resolved.assignedEmployeeId,
            branchId: resolved.branchId,
          }, context),
        });
        return publicInvoice(actor, invoice);
      } catch (error) {
        if (error instanceof ErpAssignmentError) {
          throw new SaleError('EMPLOYEE_NOT_ASSIGNABLE');
        }
        throw error;
      }
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
      return publicInvoice(actor, invoice);
    },
  };
};

export type SaleService = ReturnType<typeof createSaleService>;
