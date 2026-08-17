import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  branches: vi.fn(),
  products: vi.fn(),
}));

vi.mock('../src/features/stock-transfers/api/stock-transfers-api', () => ({
  createStockTransfer: mocks.create,
  listStockTransfers: mocks.list,
}));
vi.mock('../src/features/cashier-sessions', () => ({
  listCashierSessionBranches: mocks.branches,
}));
vi.mock('../src/features/products', () => ({
  listAllProducts: mocks.products,
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

const sourceOptionsReady = () => waitFor(() => {
  const source = screen.getByLabelText('الفرع المُرسِل');
  expect(within(source).getByRole('option', { name: 'فرع مدينة نصر' })).toBeDefined();
});

const fillTransfer = async () => {
  await sourceOptionsReady();
  fireEvent.change(screen.getByLabelText('الفرع المُرسِل'), { target: { value: '2' } });
  await waitFor(() => {
    const product = screen.getByLabelText('المنتج 1');
    expect(within(product).getByRole('option', { name: 'شامبو الأرغان (متاح 10)' })).toBeDefined();
  });
  fireEvent.change(screen.getByLabelText('الفرع المستلم'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('المنتج 1'), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText('الكمية 1'), { target: { value: '4' } });
};

beforeEach(() => {
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
    fireEvent.change(screen.getByLabelText('المنتج 2'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('الكمية 2'), { target: { value: '2' } });
    // 4 × 30.00 plus 2 × 12.50 on one transfer.
    expect((await screen.findByText(/إجمالي تكلفة التحويل/)).textContent).toContain('145.00');

    fireEvent.click(screen.getByRole('button', { name: 'تنفيذ التحويل' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![0].lines).toEqual([
      { productId: 7, quantity: 4 },
      { productId: 8, quantity: 2 },
    ]);
  });

  it('does not offer the same product twice and can drop a line', async () => {
    mocks.products.mockResolvedValue(page([
      { id: 7, name: 'شامبو الأرغان', quantity: 10, lastPurchaseCost: '30.00', isActive: true },
      { id: 8, name: 'بلسم', quantity: 9, lastPurchaseCost: '12.50', isActive: true },
    ]));
    mount();
    await fillTransfer();
    fireEvent.click(screen.getByRole('button', { name: 'إضافة منتج' }));

    const second = screen.getByLabelText('المنتج 2');
    expect(within(second).queryByRole('option', { name: 'شامبو الأرغان (متاح 10)' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'حذف البند 2' }));
    expect(screen.queryByLabelText('المنتج 2')).toBeNull();
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
});
