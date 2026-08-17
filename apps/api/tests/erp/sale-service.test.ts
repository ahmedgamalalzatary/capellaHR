import type { CompleteSaleInput, InvoiceDto, SaleQuote } from '@capella/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createSaleService,
  SaleError,
  type SaleRepository,
} from '../../src/modules/erp/sales/sale-service.js';
import { ErpAssignmentError } from '../../src/modules/erp/assignment/assignment-service.js';

const actor = { role: 'cashier' as const, accountId: 3, branchId: 2 };
const input: CompleteSaleInput = {
  clientId: 5,
  sellerEmployeeId: 9,
  cashierSessionId: 13,
  idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
  lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 8 }],
  discount: { kind: 'percentage', value: '10.00' },
  tax: { kind: 'fixed', value: '5.00' },
  payments: [{ method: 'cash', amount: '185.00' }],
};

const productInput: CompleteSaleInput = {
  clientId: 5,
  sellerEmployeeId: 9,
  cashierSessionId: 13,
  idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1631',
  lines: [{ itemType: 'product', productId: 31, quantity: 1 }],
  payments: [{ method: 'cash', amount: '200.00' }],
};

const invoice = {
  id: 44,
  invoiceNumber: 'INV-2026.08.03-14.35-17',
  status: 'completed' as const,
  kind: 'sale' as const,
  branchId: 2,
  cashierSessionId: 13,
  client: { id: 5, name: 'منى أحمد', phone: '01012345678' },
  seller: { id: 9, employeeCode: 1009, name: 'أحمد جمال' },
  authorizedBy: { accountId: 3, username: 'cashier.one' },
  lines: [{
    id: 81, lineNumber: 1, itemType: 'service' as const, sourceId: 21,
    name: 'صبغة شعر', quantity: 1, unitPrice: '200.00', lineTotal: '200.00',
    employee: { id: 8, employeeCode: 1008, name: 'سارة علي' },
    commissionRule: 'employee_override' as const, commissionRate: '15.00',
    commissionAmount: '30.00', productCostBasis: null,
    refundedQuantity: 0, refundableQuantity: 1,
  }],
  discount: { kind: 'percentage' as const, value: '10.00', amount: '20.00' },
  tax: { kind: 'fixed' as const, value: '5.00', amount: '5.00' },
  totals: {
    subtotal: '200.00', discountAmount: '20.00', taxAmount: '5.00',
    total: '185.00', paymentTotal: '185.00',
  },
  payments: [{
    method: 'cash' as const, amount: '185.00',
    refundedAmount: '0.00', refundableAmount: '185.00',
  }],
  reversals: [],
  eligibility: { canVoid: false, canRefund: true },
  soldAt: '2026-08-03T11:35:00.000Z',
} satisfies InvoiceDto;

const quote = {
  lines: [{
    itemType: 'service' as const, sourceId: 21, name: 'صبغة شعر', quantity: 1,
    unitPrice: '200.00', lineTotal: '200.00',
  }],
  discount: null,
  tax: null,
  totals: {
    subtotal: '200.00', discountAmount: '0.00', taxAmount: '0.00', total: '200.00',
  },
} satisfies SaleQuote;

const productInvoice = {
  ...invoice,
  lines: [{
    ...invoice.lines[0]!,
    itemType: 'product' as const,
    sourceId: 31,
    name: 'شامبو',
    employee: null,
    commissionRule: 'none' as const,
    commissionRate: '0.00',
    commissionAmount: '0.00',
    productCostBasis: '60.00',
  }],
} satisfies InvoiceDto;
const setup = (overrides: Partial<SaleRepository> = {}) => {
  const quoteRepository = vi.fn().mockResolvedValue(quote);
  const findByIdempotencyKey = vi.fn().mockResolvedValue(null);
  const completeRepository = vi.fn<SaleRepository['complete']>().mockResolvedValue(invoice);
  const reverse = vi.fn<SaleRepository['reverse']>().mockResolvedValue(invoice);
  const listClientVisits = vi.fn().mockResolvedValue({ items: [], total: 0 });
  const listInvoices = vi.fn().mockResolvedValue({ items: [], total: 0 });
  const findInvoiceById = vi.fn().mockResolvedValue(invoice);
  const repository: SaleRepository = {
    quote: quoteRepository,
    findByIdempotencyKey,
    complete: completeRepository,
    reverse,
    listClientVisits,
    listInvoices,
    findInvoiceById,
    ...overrides,
  };
  const assertAssignable = vi.fn().mockImplementation(
    async (_actor: unknown, request: { employeeId: number }) => ({
      id: request.employeeId,
      employeeCode: 1000 + request.employeeId,
      fullName: 'سارة علي',
      branchId: 2,
    }),
  );
  const service = createSaleService({
    repository,
    resolveBranchContext: vi.fn().mockResolvedValue({
      accountId: 3, accountRole: 'cashier', branchId: 2, employeeId: 9,
    }),
    assignment: { assertAssignable },
    invoiceNumbers: {
      allocate: vi.fn().mockResolvedValue({
        businessDate: '2026-08-03',
        sequence: 17,
        invoiceNumber: invoice.invoiceNumber,
        allocatedAt: new Date('2026-08-03T11:35:00.000Z'),
      }),
    },
  });
  return {
    service, repository, assertAssignable, quoteRepository, completeRepository,
    listInvoices, findInvoiceById,
  };
};

describe('ERP sale service', () => {
  it('quotes an exact partial refund from stored invoice facts and remaining tenders', async () => {
    const { service } = setup();
    await expect((service as unknown as {
      quoteRefund(actorValue: typeof actor, invoiceId: number, input: {
        lines: Array<{ invoiceLineId: number; quantity: number }>;
      }): Promise<unknown>;
    }).quoteRefund(actor, 44, {
      lines: [{ invoiceLineId: 81, quantity: 1 }],
    })).resolves.toEqual({
      lines: [{
        invoiceLineId: 81, quantity: 1, grossAmount: '200.00',
        discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      }],
      totals: {
        grossAmount: '200.00', discountAmount: '20.00', taxAmount: '5.00', total: '185.00',
      },
      payments: [{ method: 'cash', refundableAmount: '185.00' }],
    });
  });

  it('submits branch-scoped partial refunds and voids through the atomic repository', async () => {
    const reverse = vi.fn().mockResolvedValue(invoice);
    const { service } = setup({ reverse });
    const refund = {
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1632',
      reason: 'عدم رضا العميل',
      lines: [{ invoiceLineId: 81, quantity: 1 }],
      payments: [{ method: 'cash' as const, amount: '185.00' }],
    };

    await expect((service as unknown as {
      refund(actorValue: typeof actor, invoiceId: number, input: typeof refund): Promise<unknown>;
      void(actorValue: typeof actor, invoiceId: number, input: {
        idempotencyKey: string; reason: string;
      }): Promise<unknown>;
    }).refund(actor, 44, refund)).resolves.toEqual(invoice);
    await (service as unknown as {
      void(actorValue: typeof actor, invoiceId: number, input: {
        idempotencyKey: string; reason: string;
      }): Promise<unknown>;
    }).void(actor, 44, {
      idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1633', reason: 'إدخال مكرر',
    });

    expect(reverse).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'refund', invoiceId: 44, actingAccountId: 3,
      input: { ...refund, branchId: 2 },
    }));
    expect(reverse).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'void', invoiceId: 44, actingAccountId: 3,
      input: expect.objectContaining({ branchId: 2, reason: 'إدخال مكرر' }),
    }));
  });

  it('returns a server-authoritative quote in the resolved branch', async () => {
    const { service, quoteRepository } = setup();
    await expect(service.quote(actor, {
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00' }],
    })).resolves.toEqual(quote);
    expect(quoteRepository).toHaveBeenCalledWith(2, {
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00' }],
    });
  });

  it('returns the stored invoice without another write for an identical retry', async () => {
    const findByIdempotencyKey = vi.fn().mockResolvedValue({ input: { ...input, branchId: 2 }, invoice });
    const { service, completeRepository } = setup({
      findByIdempotencyKey,
    });
    await expect(service.complete(actor, input)).resolves.toEqual(invoice);
    expect(findByIdempotencyKey).toHaveBeenCalledWith(input.idempotencyKey, {
      actingAccountId: actor.accountId,
      actingAccountRole: actor.role,
    });
    expect(completeRepository).not.toHaveBeenCalled();
  });

  it('shows a Cashier the same invoice an Admin reads, cost basis included', async () => {
    // The Cashier runs the products screen, so the cost is theirs to see here too.
    const { service } = setup({
      complete: vi.fn().mockResolvedValue(productInvoice),
      findInvoiceById: vi.fn().mockResolvedValue(productInvoice),
    });

    const completed = await service.complete(actor, productInput);
    const detail = await service.getInvoice(actor, productInvoice.id);

    expect(completed.lines[0]).toHaveProperty('productCostBasis', '60.00');
    expect(detail.lines[0]).toHaveProperty('productCostBasis', '60.00');
  });

  it('retains product cost basis for Admin invoice responses', async () => {
    const { service } = setup({ findInvoiceById: vi.fn().mockResolvedValue(productInvoice) });
    const admin = { role: 'admin' as const, accountId: 1 };

    const detail = await service.getInvoice(admin, productInvoice.id);

    expect(detail.lines[0]).toHaveProperty('productCostBasis', '60.00');
  });

  it('rejects reuse of an idempotency key for a different request', async () => {
    const { service } = setup({
      findByIdempotencyKey: vi.fn().mockResolvedValue({
        input: { ...input, branchId: 2, clientId: 99 }, invoice,
      }),
    });
    await expect(service.complete(actor, input)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('passes an in-transaction attendance recheck to the atomic repository write', async () => {
    const { service, completeRepository, assertAssignable } = setup();
    await service.complete(actor, input);
    const operation = completeRepository.mock.calls[0]![0];
    const transaction = { id: 'transaction' };
    await operation.assertEmployees!(transaction);
    expect(assertAssignable).toHaveBeenCalledWith(
      actor,
      { employeeId: 8, branchId: 2 },
      transaction,
    );
    expect(operation.input).toEqual({ ...input, branchId: 2 });
    expect(operation.actingAccountId).toBe(3);
    expect(operation.actingAccountRole).toBe('cashier');
  });

  it('rechecks attendance for every employee named on the invoice, once each', async () => {
    const { service, completeRepository, assertAssignable } = setup();
    await service.complete(actor, {
      ...input,
      lines: [
        { itemType: 'service', serviceId: 21, quantity: 1, unitPrice: '200.00', employeeId: 11 },
        { itemType: 'service', serviceId: 22, quantity: 1, unitPrice: '150.00', employeeId: 8 },
        { itemType: 'service', serviceId: 23, quantity: 1, unitPrice: '100.00', employeeId: 11 },
        { itemType: 'product', productId: 31, quantity: 1 },
      ],
    });
    const operation = completeRepository.mock.calls[0]![0];
    const transaction = { id: 'transaction' };

    await expect(operation.assertEmployees!(transaction)).resolves.toEqual([
      expect.objectContaining({ id: 8 }),
      expect.objectContaining({ id: 11 }),
    ]);
    expect(assertAssignable).toHaveBeenCalledTimes(2);
    expect(assertAssignable).toHaveBeenNthCalledWith(
      1, actor, { employeeId: 8, branchId: 2 }, transaction,
    );
    expect(assertAssignable).toHaveBeenNthCalledWith(
      2, actor, { employeeId: 11, branchId: 2 }, transaction,
    );
  });

  it('completes a product-only invoice without employee assignment or attendance checks', async () => {
    const completeRepository = vi.fn<SaleRepository['complete']>().mockResolvedValue(productInvoice);
    const { service, assertAssignable } = setup({ complete: completeRepository });

    await expect(service.complete(actor, productInput)).resolves.toMatchObject({
      lines: [expect.objectContaining({ employee: null })],
    });

    const operation = completeRepository.mock.calls[0]![0];
    expect(operation.input).toEqual({ ...productInput, branchId: 2 });
    expect(Reflect.get(operation, 'assertEmployees')).toBeUndefined();
    expect(assertAssignable).not.toHaveBeenCalled();
  });

  it('maps an attendance race to the stable sale error', async () => {
    const repositoryComplete = vi.fn<SaleRepository['complete']>(async (operation) => {
      await operation.assertEmployees!({});
      return invoice;
    });
    const { repository } = setup({ complete: repositoryComplete });
    const assignmentFailure = new ErpAssignmentError('ERP_EMPLOYEE_NOT_PRESENT', 'not present');
    const failing = createSaleService({
      repository,
      resolveBranchContext: vi.fn().mockResolvedValue({
        accountId: 3, accountRole: 'cashier', branchId: 2, employeeId: 9,
      }),
      assignment: { assertAssignable: vi.fn().mockRejectedValue(assignmentFailure) },
      invoiceNumbers: {
        allocate: vi.fn().mockResolvedValue({
          businessDate: '2026-08-03', sequence: 17,
          invoiceNumber: invoice.invoiceNumber,
          allocatedAt: new Date('2026-08-03T11:35:00.000Z'),
        }),
      },
    });
    await expect(failing.complete(actor, input)).rejects.toEqual(
      new SaleError('EMPLOYEE_NOT_ASSIGNABLE'),
    );
  });

  it('lists and reads stored invoices only through the resolved branch', async () => {
    const { service, listInvoices, findInvoiceById } = setup();
    await service.listInvoices(actor, { page: 2, pageSize: 10 });
    await expect(service.getInvoice(actor, 44, undefined)).resolves.toEqual(invoice);

    expect(listInvoices).toHaveBeenCalledWith(2, { page: 2, pageSize: 10 });
    expect(findInvoiceById).toHaveBeenCalledWith(2, 44);
  });

  it('returns a stable not-found error without leaking cross-branch invoice existence', async () => {
    const { service } = setup({ findInvoiceById: vi.fn().mockResolvedValue(null) });
    await expect(service.getInvoice(actor, 44, undefined)).rejects.toEqual(
      new SaleError('INVOICE_NOT_FOUND'),
    );
  });
});
