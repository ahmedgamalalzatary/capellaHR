import type { CompleteSaleInput, InvoiceDto, SaleQuote } from '@capella/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createSaleService,
  SaleError,
  type SaleRepository,
} from '../../src/modules/erp/sales/sale-service.js';
import { ErpAssignmentError } from '../../src/modules/erp/assignment/assignment-service.js';

const actor = { role: 'cashier' as const, accountId: 3, employeeId: 9 };
const input: CompleteSaleInput = {
  clientId: 5,
  assignedEmployeeId: 8,
  cashierSessionId: 13,
  idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
  lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
  discount: { kind: 'percentage', value: '10.00' },
  tax: { kind: 'fixed', value: '5.00' },
  payments: [{ method: 'cash', amount: '185.00' }],
};

const invoice = {
  id: 44,
  invoiceNumber: 'INV-2026.08.03-14.35-17',
  status: 'completed' as const,
  branchId: 2,
  cashierSessionId: 13,
  client: { id: 5, name: 'منى أحمد', phone: '01012345678' },
  assignedEmployee: { id: 8, employeeCode: 1008, name: 'سارة علي' },
  authorizedBy: { accountId: 3, username: 'cashier.one' },
  lines: [{
    id: 81, lineNumber: 1, itemType: 'service' as const, sourceId: 21,
    name: 'صبغة شعر', quantity: 1, unitPrice: '200.00', lineTotal: '200.00',
    commissionRule: 'employee_override' as const, commissionRate: '15.00',
    commissionAmount: '30.00', productCostBasis: null,
  }],
  discount: { kind: 'percentage' as const, value: '10.00', amount: '20.00' },
  tax: { kind: 'fixed' as const, value: '5.00', amount: '5.00' },
  totals: {
    subtotal: '200.00', discountAmount: '20.00', taxAmount: '5.00',
    total: '185.00', paymentTotal: '185.00',
  },
  payments: [{ method: 'cash' as const, amount: '185.00' }],
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

const setup = (overrides: Partial<SaleRepository> = {}) => {
  const quoteRepository = vi.fn().mockResolvedValue(quote);
  const findByIdempotencyKey = vi.fn().mockResolvedValue(null);
  const completeRepository = vi.fn<SaleRepository['complete']>().mockResolvedValue(invoice);
  const listClientVisits = vi.fn().mockResolvedValue({ items: [], total: 0 });
  const repository: SaleRepository = {
    quote: quoteRepository,
    findByIdempotencyKey,
    complete: completeRepository,
    listClientVisits,
    ...overrides,
  };
  const assertAssignable = vi.fn().mockResolvedValue(invoice.assignedEmployee);
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
  return { service, repository, assertAssignable, quoteRepository, completeRepository };
};

describe('ERP sale service', () => {
  it('returns a server-authoritative quote in the resolved branch', async () => {
    const { service, quoteRepository } = setup();
    await expect(service.quote(actor, {
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
    })).resolves.toEqual(quote);
    expect(quoteRepository).toHaveBeenCalledWith(2, {
      lines: [{ itemType: 'service', serviceId: 21, quantity: 1 }],
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
    await operation.assertEmployee(transaction);
    expect(assertAssignable).toHaveBeenCalledWith(
      actor,
      { employeeId: 8, branchId: 2 },
      transaction,
    );
    expect(operation.input).toEqual({ ...input, branchId: 2 });
    expect(operation.actingAccountId).toBe(3);
    expect(operation.actingAccountRole).toBe('cashier');
  });

  it('maps an attendance race to the stable sale error', async () => {
    const repositoryComplete = vi.fn<SaleRepository['complete']>(async (operation) => {
      await operation.assertEmployee({});
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
});
