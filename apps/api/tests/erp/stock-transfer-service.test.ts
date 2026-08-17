import { describe, expect, it, vi } from 'vitest';

import {
  createStockTransferService,
  StockTransferError,
  type StockTransferRepository,
} from '../../src/modules/erp/transfers/stock-transfer-service.js';

const admin = { accountId: 1, role: 'admin' as const };
const cashier = { accountId: 2, role: 'cashier' as const, branchId: 5 };
const now = new Date('2026-08-17T09:00:00.000Z');

const input = {
  idempotencyKey: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1650',
  sourceBranchId: 5,
  destinationBranchId: 6,
  lines: [{ productId: 7, quantity: 2 }],
};

const posted = {
  id: 3, sourceBranchId: 5, sourceBranchName: 'فرع مدينة نصر',
  destinationBranchId: 6, destinationBranchName: 'فرع المعادي',
  invoiceId: 40, invoiceNumber: 'INV.2026.08.17.0001', transferDate: '2026-08-17',
  totalCost: '60.00', note: null, actingAccountId: 1, createdAt: now,
  lines: [{
    sourceProductId: 7, destinationProductId: 21, productName: 'شامبو',
    quantity: 2, unitCost: '30.00', lineTotal: '60.00',
  }],
};

const transaction = { marker: 'sale-transaction' };

const catalog: Record<number, { name: string; cost: string }> = {
  7: { name: 'شامبو', cost: '30.00' },
  8: { name: 'بلسم', cost: '12.50' },
};

type FakeInvoice = {
  id: number;
  lines: Array<{
    itemType: 'service' | 'product';
    sourceId: number;
    name: string;
    quantity: number;
    unitPrice: string;
  }>;
};

const build = (
  overrides: Partial<StockTransferRepository> = {},
  // What the sale locked, when that differs from what the transfer quoted.
  invoiceCosts: Record<number, string> = {},
) => {
  // The real sale runs the caller's work inside its transaction; so does this,
  // and it hands back the invoice it priced rather than a bare id.
  const sales = {
    complete: vi.fn(async (
      _actor: unknown,
      saleInput: { lines: Array<{ productId: number; quantity: number }> },
      options?: { afterInvoice?: (tx: unknown, invoice: FakeInvoice) => Promise<void> },
    ) => {
      const invoice: FakeInvoice = {
        id: 40,
        lines: saleInput.lines.map((line) => ({
          itemType: 'product' as const,
          sourceId: line.productId,
          name: catalog[line.productId]!.name,
          quantity: line.quantity,
          unitPrice: invoiceCosts[line.productId] ?? catalog[line.productId]!.cost,
        })),
      };
      await options?.afterInvoice?.(transaction, invoice);
      return { id: 40 };
    }),
  };
  const repository: StockTransferRepository = {
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    readSourceProducts: vi.fn().mockResolvedValue([
      { id: 7, name: 'شامبو', unitCost: '30.00', quantity: 5, isActive: true },
    ]),
    ensureTransferClient: vi.fn().mockResolvedValue(9),
    findOpenSession: vi.fn().mockResolvedValue({ id: 77 }),
    applyDestination: vi.fn().mockResolvedValue(posted),
    list: vi.fn().mockResolvedValue({ items: [posted], total: 1 }),
    ...overrides,
  };
  const branches = {
    findById: vi.fn(async (id: number) => (
      id === 5 ? { id: 5, name: 'فرع مدينة نصر' } : id === 6 ? { id: 6, name: 'فرع المعادي' } : null
    )),
  };
  const service = createStockTransferService({
    repository,
    sales: sales,
    branches: branches,
    now: () => now,
  });
  return { service, repository, sales, branches };
};

describe('ERP stock transfer service', () => {
  it('sells the goods to the receiving branch at cost, on the source branch shift', async () => {
    const ensureTransferClient = vi.fn().mockResolvedValue(9);
    const applyDestination = vi.fn().mockResolvedValue(posted);
    const { service, sales } = build({ ensureTransferClient, applyDestination });

    // The posted transfer is what the receiving side wrote, not a lookup after.
    await expect(service.transfer(admin, input)).resolves.toEqual(posted);
    expect(applyDestination).toHaveBeenCalledWith(transaction, expect.objectContaining({
      invoiceId: 40,
      sourceBranchId: 5,
      destinationBranchId: 6,
      note: null,
      lines: [{ productId: 7, productName: 'شامبو', quantity: 2, unitCost: '30.00' }],
    }));

    expect(sales.complete).toHaveBeenCalledTimes(1);
    const [actor, saleInput, options] = sales.complete.mock.calls[0]!;
    expect(actor).toBe(admin);
    expect(saleInput).toMatchObject({
      branchId: 5,
      clientId: 9,
      cashierSessionId: 77,
      idempotencyKey: input.idempotencyKey,
      lines: [{ itemType: 'product', productId: 7, quantity: 2 }],
      // 2 × 30.00 at cost, settled in full so the invoice balances.
      payments: [{ method: 'cash', amount: '60.00' }],
    });
    expect(options).toMatchObject({ pricing: 'cost' });
    // Nobody sells internal trade, so no employee is named and none is paid.
    expect(saleInput).not.toHaveProperty('sellerEmployeeId');
    expect(ensureTransferClient).toHaveBeenCalledWith(5, 'فرع المعادي', now);
  });

  it('refuses anyone but an admin', async () => {
    const { service, sales } = build();

    await expect(service.transfer(cashier, input)).rejects.toMatchObject({
      code: 'TRANSFER_ADMIN_REQUIRED',
    });
    expect(sales.complete).not.toHaveBeenCalled();
  });

  it('will not move a product that has no cost to sell at', async () => {
    const { service } = build({
      readSourceProducts: vi.fn().mockResolvedValue([
        { id: 7, name: 'شامبو', unitCost: '0.00', quantity: 5, isActive: true },
      ]),
    });

    await expect(service.transfer(admin, input)).rejects.toMatchObject({
      code: 'TRANSFER_COST_REQUIRED',
    });
  });

  it('moves several products in one transfer, priced at each cost', async () => {
    const { service, sales } = build({
      readSourceProducts: vi.fn().mockResolvedValue([
        { id: 7, name: 'شامبو', unitCost: '30.00', quantity: 5, isActive: true },
        { id: 8, name: 'بلسم', unitCost: '12.50', quantity: 9, isActive: true },
      ]),
    });

    await service.transfer(admin, {
      ...input,
      lines: [{ productId: 7, quantity: 2 }, { productId: 8, quantity: 4 }],
    });

    const [, saleInput] = sales.complete.mock.calls[0]!;
    expect(saleInput).toMatchObject({
      lines: [
        { itemType: 'product', productId: 7, quantity: 2 },
        { itemType: 'product', productId: 8, quantity: 4 },
      ],
      // 2 × 30.00 plus 4 × 12.50.
      payments: [{ method: 'cash', amount: '110.00' }],
    });
  });

  it('will not move more than the sending branch holds', async () => {
    const { service } = build({
      readSourceProducts: vi.fn().mockResolvedValue([
        { id: 7, name: 'شامبو', unitCost: '30.00', quantity: 1, isActive: true },
      ]),
    });

    await expect(service.transfer(admin, input)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
  });

  it('reports a missing product and an unknown branch separately', async () => {
    const { service } = build({ readSourceProducts: vi.fn().mockResolvedValue([]) });
    await expect(service.transfer(admin, input)).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
    });

    const other = build();
    await expect(other.service.transfer(admin, { ...input, destinationBranchId: 99 }))
      .rejects.toMatchObject({ code: 'TRANSFER_BRANCH_NOT_FOUND' });
  });

  it('needs an open shift at the sending branch to invoice against', async () => {
    const { service } = build({ findOpenSession: vi.fn().mockResolvedValue(null) });

    await expect(service.transfer(admin, input)).rejects.toMatchObject({
      code: 'TRANSFER_SHIFT_REQUIRED',
    });
  });

  it('returns the transfer already posted under the same key instead of repeating it', async () => {
    const { service, sales } = build({
      findByIdempotencyKey: vi.fn().mockResolvedValue(posted),
    });

    await expect(service.transfer(admin, input)).resolves.toEqual(posted);
    expect(sales.complete).not.toHaveBeenCalled();
  });

  it('records what the sale charged when costs move but the total does not', async () => {
    const applyDestination = vi.fn().mockResolvedValue(posted);
    const { service } = build({
      applyDestination,
      readSourceProducts: vi.fn().mockResolvedValue([
        { id: 7, name: 'شامبو', unitCost: '30.00', quantity: 5, isActive: true },
        { id: 8, name: 'بلسم', unitCost: '12.50', quantity: 9, isActive: true },
      ]),
    }, { 7: '35.00', 8: '10.00' });

    // 2 × 35.00 plus 4 × 10.00 is the same 110.00 we quoted at 30.00 and 12.50,
    // so the payment still balances and only the per-product costs moved.
    await service.transfer(admin, {
      ...input,
      lines: [{ productId: 7, quantity: 2 }, { productId: 8, quantity: 4 }],
    });

    expect(applyDestination).toHaveBeenCalledWith(transaction, expect.objectContaining({
      lines: [
        { productId: 7, productName: 'شامبو', quantity: 2, unitCost: '35.00' },
        { productId: 8, productName: 'بلسم', quantity: 4, unitCost: '10.00' },
      ],
    }));
  });

  it('refuses a key reused for different goods or a different branch', async () => {
    const goods = build({ findByIdempotencyKey: vi.fn().mockResolvedValue(posted) });
    await expect(goods.service.transfer(admin, {
      ...input, lines: [{ productId: 7, quantity: 3 }],
    })).rejects.toMatchObject({ code: 'TRANSFER_KEY_REUSED' });
    expect(goods.sales.complete).not.toHaveBeenCalled();

    const branch = build({ findByIdempotencyKey: vi.fn().mockResolvedValue(posted) });
    await expect(branch.service.transfer(admin, { ...input, destinationBranchId: 9 }))
      .rejects.toMatchObject({ code: 'TRANSFER_KEY_REUSED' });

    const noted = build({ findByIdempotencyKey: vi.fn().mockResolvedValue(posted) });
    await expect(noted.service.transfer(admin, { ...input, note: 'مختلف' }))
      .rejects.toMatchObject({ code: 'TRANSFER_KEY_REUSED' });
  });

  it('turns what the till did underneath the transfer into a stated reason', async () => {
    const cases: Array<[string, string]> = [
      ['PAYMENT_TOTAL_MISMATCH', 'TRANSFER_COST_CHANGED'],
      ['INSUFFICIENT_STOCK', 'INSUFFICIENT_STOCK'],
      ['PRODUCT_UNAVAILABLE', 'PRODUCT_NOT_FOUND'],
      ['CASHIER_SESSION_NOT_OPEN', 'TRANSFER_SHIFT_REQUIRED'],
      ['IDEMPOTENCY_CONFLICT', 'TRANSFER_KEY_REUSED'],
    ];

    for (const [saleCode, transferCode] of cases) {
      const { service, sales } = build();
      sales.complete.mockRejectedValue(
        Object.assign(new Error(saleCode), { name: 'SaleError', code: saleCode }),
      );
      await expect(service.transfer(admin, input)).rejects.toMatchObject({ code: transferCode });
    }
  });

  it('lets an unexpected failure surface instead of dressing it as a transfer error', async () => {
    const { service, sales } = build();
    sales.complete.mockRejectedValue(new Error('connection lost'));

    await expect(service.transfer(admin, input)).rejects.toThrow('connection lost');
  });

  it('will not move a product the sending branch has retired', async () => {
    const { service } = build({
      readSourceProducts: vi.fn().mockResolvedValue([
        { id: 7, name: 'شامبو', unitCost: '30.00', quantity: 5, isActive: false },
      ]),
    });

    await expect(service.transfer(admin, input)).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('keeps the transfer list to admins as well', async () => {
    const { service, repository } = build();

    await expect(service.list(cashier, { page: 1, pageSize: 20 })).rejects.toMatchObject({
      code: 'TRANSFER_ADMIN_REQUIRED',
    });
    await expect(service.list(admin, { page: 1, pageSize: 20 }))
      .resolves.toEqual({ items: [posted], total: 1 });
    void repository;
  });

  it('creates no client for a branch with no open shift', async () => {
    const ensureTransferClient = vi.fn().mockResolvedValue(9);
    const { service } = build({
      ensureTransferClient, findOpenSession: vi.fn().mockResolvedValue(null),
    });

    await expect(service.transfer(admin, input)).rejects.toMatchObject({
      code: 'TRANSFER_SHIFT_REQUIRED',
    });
    // Clients are never deleted, so none may be created for a refused transfer.
    expect(ensureTransferClient).not.toHaveBeenCalled();
  });

  it('carries every error message in Arabic', () => {
    expect(new StockTransferError('TRANSFER_ADMIN_REQUIRED').message).toMatch(/[؀-ۿ]/u);
    expect(new StockTransferError('TRANSFER_SHIFT_REQUIRED').message).toMatch(/[؀-ۿ]/u);
  });
});
