import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  branches: vi.fn(),
  products: vi.fn(),
  actor: { current: { type: 'admin' } as
    | { type: 'admin' }
    | { type: 'cashier'; accountId: number } },
  currentSession: vi.fn(),
}));

vi.mock('../src/features/stock-transfers/api/stock-transfers-api', () => ({
  createStockTransfer: mocks.create,
  listStockTransfers: mocks.list,
}));
vi.mock('../src/features/cashier-sessions', () => ({
  listCashierSessionBranches: mocks.branches,
  getCurrentCashierSession: mocks.currentSession,
  cashierSessionQueryKeys: {
    current: () => ['cashier-sessions', 'current', 'cashier'],
  },
}));
vi.mock('../src/features/products', () => ({
  listAllProducts: mocks.products,
}));
vi.mock('../src/features/auth', () => ({
  useSession: () => ({ data: { actor: mocks.actor.current } }),
}));
import { StockTransfersView } from '../src/features/stock-transfers/components/stock-transfers-view';

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1 },
});

const transfer = {
  id: 4,
  sourceBranchId: 2,
  sourceBranchName: 'فرع مدينة نصر',
  destinationBranchId: 3,
  destinationBranchName: 'فرع المعادي',
  invoiceId: 90,
  invoiceNumber: 'INV.2026.08.17.0001',
  transferDate: '2026-08-17',
  totalCost: '120.00',
  note: 'نقل مخزون',
  actingAccountId: 1,
  createdAt: '2026-08-17T09:00:00.000Z',
  lines: [{
    sourceProductId: 7,
    destinationProductId: 21,
    productName: 'شامبو الأرغان',
    quantity: 4,
    unitCost: '30.00',
    lineTotal: '120.00',
  }],
};

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })}>
      <StockTransfersView />
    </QueryClientProvider>,
  );
}

const openTransferDialog = async () => {
  if (!screen.queryByLabelText('الفرع المُرسِل')) {
    fireEvent.click(await screen.findByRole('button', { name: 'تحويل جديد' }));
  }
};

const sourceOptionsReady = async () => {
  await openTransferDialog();
  await waitFor(() => {
    const source = screen.getByLabelText('الفرع المُرسِل');
    expect(within(source).getByRole('option', { name: 'فرع مدينة نصر' })).toBeDefined();
  });
};

const fillTransfer = async () => {
  await sourceOptionsReady();
  fireEvent.change(screen.getByLabelText('الفرع المُرسِل'), { target: { value: '2' } });
  await waitFor(() => {
    const product = screen.getByLabelText('المنتج 1');
    expect(product).not.toHaveProperty('disabled', true);
  });
  fireEvent.change(screen.getByLabelText('الفرع المستلم'), { target: { value: '3' } });
  fireEvent.click(screen.getByLabelText('المنتج 1'));
  fireEvent.click(screen.getByRole('option', { name: /شامبو الأرغان/ }));
  fireEvent.change(screen.getByLabelText('الكمية 1'), { target: { value: '4' } });
};

beforeEach(() => {
  sessionStorage.clear();
  mocks.actor.current = { type: 'admin' };
  mocks.currentSession.mockResolvedValue(null);
  mocks.branches.mockResolvedValue(page([
    { id: 2, name: 'فرع مدينة نصر' },
    { id: 3, name: 'فرع المعادي' },
  ]));
  mocks.products.mockResolvedValue(page([
    { id: 7, name: 'شامبو الأرغان', quantity: 10, lastPurchaseCost: '30.00', isActive: true },
  ]));
  mocks.list.mockResolvedValue(page([transfer]));
  mocks.create.mockResolvedValue(transfer);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StockTransfersView', () => {
  it('places the add button next to the page header', async () => {
    mount();

    await screen.findByRole('button', { name: 'تحويل جديد' });
    const header = screen.getByRole('heading', { name: 'تحويل المنتجات بين الفروع' }).closest('div')!.parentElement!;
    expect(within(header).getByRole('button', { name: 'تحويل جديد' })).toBeDefined();
  });

  it('pins a cashier to their own source branch and history', async () => {
    mocks.actor.current = { type: 'cashier', accountId: 8 };
    mocks.currentSession.mockResolvedValue({
      id: 14,
      branchId: 2,
      branchName: 'فرع مدينة نصر',
      openedByAccountId: 8,
      openedByUsername: 'cashier-nasr',
      openedAt: '2026-09-06T08:00:00.000+03:00',
      closedAt: null,
      closedByAccountId: null,
      closedByUsername: null,
      autoClosedAt: null,
    });
    mount();

    await openTransferDialog();
    const source = screen.getAllByRole('combobox')[0]!;
    await waitFor(() => expect(source).toHaveProperty('value', '2'));
    expect(source).toHaveProperty('disabled', true);
    await waitFor(() => expect(mocks.products).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 2, isActive: true }),
    ));
    expect(mocks.list).toHaveBeenCalledWith({ page: 1, branchId: 2 });
  });

  it('sends the products the admin chose from one branch to the other', async () => {
    mount();
    await fillTransfer();

    fireEvent.click(screen.getByRole('button', { name: 'تنفيذ التحويل' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({
      sourceBranchId: 2,
      destinationBranchId: 3,
      lines: [{ productId: 7, quantity: 4 }],
    });
    // Internal trade: nobody sells it, so no employee is submitted.
    expect(mocks.create.mock.calls[0]![0]).not.toHaveProperty('sellerEmployeeId');
    // A note is optional and was left empty.
    expect(mocks.create.mock.calls[0]![0]).not.toHaveProperty('note');
    // A fresh key each time, so a retry cannot double-move the stock.
    expect(mocks.create.mock.calls[0]![0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('shows the cost of what is being moved before it is sent', async () => {
    mount();
    await fillTransfer();

    // 4 × 30.00 at cost, which is what the receiving branch will be invoiced.
    const cost = await screen.findByText(/إجمالي تكلفة التحويل/);
    expect(cost.textContent).toContain('120.00');
  });

  it('moves several products in one transfer', async () => {
    mocks.products.mockResolvedValue(page([
      { id: 7, name: 'شامبو الأرغان', quantity: 10, lastPurchaseCost: '30.00', isActive: true },
      { id: 8, name: 'بلسم', quantity: 9, lastPurchaseCost: '12.50', isActive: true },
    ]));
    mount();
    await fillTransfer();

    fireEvent.click(screen.getByRole('button', { name: 'إضافة منتج' }));
    fireEvent.click(screen.getByLabelText('المنتج 1'));
    fireEvent.click(screen.getByRole('option', { name: /بلسم/ }));
    fireEvent.change(screen.getByLabelText('الكمية 1'), { target: { value: '2' } });
    // 4 × 30.00 plus 2 × 12.50 on one transfer.
    expect((await screen.findByText(/إجمالي تكلفة التحويل/)).textContent).toContain('145.00');

    fireEvent.click(screen.getByRole('button', { name: 'تنفيذ التحويل' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![0].lines).toEqual([
      { productId: 8, quantity: 2 },
      { productId: 7, quantity: 4 },
    ]);
  });

  it('searches products by name or barcode before selecting one', async () => {
    mocks.products.mockResolvedValue(page([
      { id: 7, name: 'شامبو الأرغان', barcode: '62210001', quantity: 10, lastPurchaseCost: '30.00', isActive: true },
      { id: 8, name: 'بلسم', barcode: '62210002', quantity: 9, lastPurchaseCost: '12.50', isActive: true },
    ]));
    mount();
    await sourceOptionsReady();
    fireEvent.change(screen.getByLabelText('الفرع المُرسِل'), { target: { value: '2' } });

    const picker = await screen.findByRole('combobox', { name: 'المنتج 1' });
    await waitFor(() => expect(picker).not.toHaveProperty('disabled', true));
    fireEvent.click(picker);
    const search = screen.getByRole('searchbox', { name: 'بحث عن المنتج 1' });
    fireEvent.change(search, { target: { value: '62210002' } });

    expect(screen.queryByRole('option', { name: /شامبو الأرغان/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /بلسم/ }));
    expect(picker.textContent).toContain('بلسم');
  });

  it('adds each new product row above the existing rows', async () => {
    mocks.products.mockResolvedValue(page([
      { id: 7, name: 'شامبو الأرغان', barcode: null, quantity: 10, lastPurchaseCost: '30.00', isActive: true },
      { id: 8, name: 'بلسم', barcode: null, quantity: 9, lastPurchaseCost: '12.50', isActive: true },
    ]));
    mount();
    await sourceOptionsReady();
    fireEvent.change(screen.getByLabelText('الفرع المُرسِل'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByLabelText('المنتج 1')).not.toHaveProperty('disabled', true));
    fireEvent.click(screen.getByLabelText('المنتج 1'));
    fireEvent.click(screen.getByRole('option', { name: /شامبو الأرغان/ }));
    fireEvent.click(screen.getByRole('button', { name: 'إضافة منتج' }));

    const productFields = screen.getAllByRole('combobox', { name: /المنتج \d+/ });
    expect(productFields.map((field) => field.getAttribute('aria-label'))).toEqual([
      'المنتج 1', 'المنتج 2',
    ]);
    expect(productFields[0]?.textContent).toContain('اختر المنتج');
    expect(productFields[1]?.textContent).toContain('شامبو الأرغان');
  });

  it('does not offer the same product twice and can drop a line', async () => {
    mocks.products.mockResolvedValue(page([
      { id: 7, name: 'شامبو الأرغان', quantity: 10, lastPurchaseCost: '30.00', isActive: true },
      { id: 8, name: 'بلسم', quantity: 9, lastPurchaseCost: '12.50', isActive: true },
    ]));
    mount();
    await fillTransfer();
    fireEvent.click(screen.getByRole('button', { name: 'إضافة منتج' }));

    const first = screen.getByLabelText('المنتج 1');
    fireEvent.click(first);
    expect(screen.queryByRole('option', { name: /شامبو الأرغان/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'حذف البند 1' }));
    expect(screen.getAllByRole('combobox', { name: /المنتج \d+/ })).toHaveLength(1);
  });

  it('offers only the sending branch products and refuses its own branch as destination', async () => {
    mount();
    await sourceOptionsReady();
    fireEvent.change(screen.getByLabelText('الفرع المُرسِل'), { target: { value: '2' } });

    await waitFor(() => expect(mocks.products).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 2, isActive: true }),
    ));
    const destination = screen.getByLabelText('الفرع المستلم');
    expect(within(destination).queryByRole('option', { name: 'فرع مدينة نصر' })).toBeNull();
  });

  it('keeps the admin on the form and explains why a transfer was refused', async () => {
    mocks.create.mockRejectedValue(new ApiError(409, {
      code: 'TRANSFER_SHIFT_REQUIRED',
      message: 'يجب وجود وردية مفتوحة في الفرع المُرسِل لتسجيل التحويل',
    }));
    mount();
    await fillTransfer();

    fireEvent.click(screen.getByRole('button', { name: 'تنفيذ التحويل' }));

    expect(await screen.findByText(/وردية مفتوحة/)).toBeDefined();
  });

  it('lists what has already been transferred with both branches and the invoice', async () => {
    mount();

    const row = (await screen.findByText('INV.2026.08.17.0001')).closest('tr')!;
    expect(row.textContent).toContain('فرع مدينة نصر');
    expect(row.textContent).toContain('فرع المعادي');
    expect(row.textContent).toContain('120.00');
  });

  it('says so and offers nothing when the branch products cannot be loaded', async () => {
    mocks.products.mockRejectedValue(new ApiError(503, {
      code: 'SERVICE_UNAVAILABLE', message: 'تعذر تحميل منتجات الفرع',
    }));
    mount();
    await sourceOptionsReady();
    fireEvent.change(screen.getByLabelText('الفرع المُرسِل'), { target: { value: '2' } });

    expect(await screen.findByText('تعذر تحميل منتجات الفرع')).toBeDefined();
    // An empty list would read as "this branch holds nothing" instead of a fault.
    expect(screen.getByLabelText('المنتج 1')).toHaveProperty('disabled', true);
  });

  it('will not submit before both branches and a product are chosen', async () => {
    mount();
    await sourceOptionsReady();

    fireEvent.click(screen.getByRole('button', { name: 'تنفيذ التحويل' }));

    expect(mocks.create).not.toHaveBeenCalled();
    expect(await screen.findByText(/اختر الفرع المُرسِل والمستلم/)).toBeDefined();
  });

  it('opens the transfer form in a dialog instead of inline', async () => {
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'تحويل جديد' })).toBeDefined());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('الفرع المُرسِل')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'تحويل جديد' }));
    const dialog = await screen.findByRole('dialog', { name: 'تحويل جديد' });
    expect(dialog).toBeDefined();
  });

  it('puts the products column last in the transfers table', async () => {
    mount();

    const headers = await screen.findAllByRole('columnheader');
    const labels = headers.map((header) => header.textContent?.trim());
    expect(labels).toEqual(['التاريخ', 'من فرع', 'إلى فرع', 'التكلفة', 'الفاتورة', 'المنتجات']);
  });

  it('shows only a preview of the products in the row', async () => {
    mocks.list.mockResolvedValue(page([{
      ...transfer,
      lines: [
        { sourceProductId: 1, destinationProductId: 11, productName: 'منتج أول', quantity: 1, unitCost: '10.00', lineTotal: '10.00' },
        { sourceProductId: 2, destinationProductId: 12, productName: 'منتج ثان', quantity: 2, unitCost: '20.00', lineTotal: '40.00' },
        { sourceProductId: 3, destinationProductId: 13, productName: 'منتج ثالث', quantity: 3, unitCost: '30.00', lineTotal: '90.00' },
      ],
    }]));
    mount();

    const row = (await screen.findByText('INV.2026.08.17.0001')).closest('tr')!;
    expect(row.textContent).toContain('منتج أول');
    expect(row.textContent).toContain('منتج ثان');
    expect(row.textContent).not.toContain('منتج ثالث');
    expect(row.textContent).toMatch(/\+1|و 1|المزيد|أخرى/);
  });

  it('opens a popup with everything about the transfer when its row is clicked', async () => {
    mocks.list.mockResolvedValue(page([{
      ...transfer,
      lines: [
        { sourceProductId: 1, destinationProductId: 11, productName: 'منتج أول', quantity: 1, unitCost: '10.00', lineTotal: '10.00' },
        { sourceProductId: 2, destinationProductId: 12, productName: 'منتج ثان', quantity: 2, unitCost: '20.00', lineTotal: '40.00' },
        { sourceProductId: 3, destinationProductId: 13, productName: 'منتج ثالث', quantity: 3, unitCost: '30.00', lineTotal: '90.00' },
      ],
    }]));
    mount();

    const row = (await screen.findByText('INV.2026.08.17.0001')).closest('tr')!;
    fireEvent.click(row);

    const dialog = await screen.findByRole('dialog', { name: /تفاصيل التحويل/ });
    expect(dialog.textContent).toContain('فرع مدينة نصر');
    expect(dialog.textContent).toContain('فرع المعادي');
    expect(dialog.textContent).toContain('2026-08-17');
    expect(dialog.textContent).toContain('INV.2026.08.17.0001');
    expect(dialog.textContent).toContain('نقل مخزون');
    // Every moved product is listed inside the popup, even the truncated one.
    expect(dialog.textContent).toContain('منتج أول');
    expect(dialog.textContent).toContain('منتج ثان');
    expect(dialog.textContent).toContain('منتج ثالث');

    fireEvent.click(within(dialog).getByRole('button', { name: /إغلاق|رجوع/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /تفاصيل التحويل/ })).toBeNull());
  });
});
