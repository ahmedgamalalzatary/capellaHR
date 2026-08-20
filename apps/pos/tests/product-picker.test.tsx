import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

import { ProductPicker } from '../src/features/products/index.js';

const mocks = vi.hoisted(() => ({
  listSellableProducts: vi.fn(async ({ page = 1 }: { page?: number }) => ({
    items: page === 1 ? [{
      id: 4, branchId: 2, name: 'شامبو', description: null, sellingPrice: '100.00',
      isActive: true, quantity: 1,
    }] : [{
      id: 5, branchId: 2, name: 'بلسم', description: null, sellingPrice: '80.00',
      isActive: true, quantity: 2,
    }],
    meta: { page, pageSize: 50, total: 2, totalPages: 2 },
  })),
  lookupProductByBarcode: vi.fn(),
}));

vi.mock('../src/features/products/api/products-api', () => ({
  listSellableProducts: mocks.listSellableProducts,
  lookupProductByBarcode: mocks.lookupProductByBarcode,
}));

/** The QW2100 types a whole code in tens of milliseconds and presses Enter. */
const scanCode = (code: string) => {
  for (const character of code) {
    vi.advanceTimersByTime(10);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: character, bubbles: true }));
  }
  vi.advanceTimersByTime(10);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('ProductPicker', () => {
  it('announces product loading', () => {
    mocks.listSellableProducts.mockImplementationOnce(() => new Promise(() => undefined));
    render(<QueryClientProvider client={new QueryClient()}><ProductPicker branchId={2} onSelect={vi.fn()} /></QueryClientProvider>);
    expect(screen.getByRole('status', { name: 'جارٍ تحميل المنتجات…' })).toBeDefined();
  });

  it('shows available quantity and selects an in-stock product', async () => {
    const onSelect = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><ProductPicker branchId={2} onSelect={onSelect} /></QueryClientProvider>);
    expect(await screen.findByText('متاح: 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /شامبو/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 4, price: '100.00', quantityAvailable: 1 }));
  });

  it('loads and appends another page of products', async () => {
    render(<QueryClientProvider client={new QueryClient()}><ProductPicker branchId={2} onSelect={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByText('شامبو')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'تحميل المزيد' }));

    expect(await screen.findByText('بلسم')).toBeTruthy();
    expect(screen.getByText('شامبو')).toBeTruthy();
    expect(mocks.listSellableProducts).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 50 }));
  });

  it('adds the scanned product straight to the sale', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSelect = vi.fn();
    mocks.lookupProductByBarcode.mockResolvedValue({
      id: 5, branchId: 2, name: 'بلسم', description: null, sellingPrice: '80.00',
      barcode: '2000000000051', isActive: true, quantity: 2,
    });
    render(<QueryClientProvider client={new QueryClient()}><ProductPicker branchId={2} onSelect={onSelect} /></QueryClientProvider>);

    scanCode('2000000000051');
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, price: '80.00', quantityAvailable: 2 }),
    ));
    expect(mocks.lookupProductByBarcode).toHaveBeenCalledWith('2000000000051', { branchId: 2 });
  });

  it('says so when the scanned code belongs to nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.lookupProductByBarcode.mockRejectedValue(new ApiError(404, { code: 'PRODUCT_NOT_FOUND', message: 'المنتج غير موجود' }));
    render(<QueryClientProvider client={new QueryClient()}><ProductPicker branchId={2} onSelect={vi.fn()} /></QueryClientProvider>);

    scanCode('9999999999999');
    expect((await screen.findByRole('alert')).textContent).toContain('المنتج غير موجود');
  });

  it('refuses to sell a scanned product that is out of stock or stopped', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSelect = vi.fn();
    mocks.lookupProductByBarcode.mockResolvedValue({
      id: 5, branchId: 2, name: 'بلسم', description: null, sellingPrice: '80.00',
      barcode: '2000000000051', isActive: true, quantity: 0,
    });
    render(<QueryClientProvider client={new QueryClient()}><ProductPicker branchId={2} onSelect={onSelect} /></QueryClientProvider>);

    scanCode('2000000000051');
    expect((await screen.findByRole('alert')).textContent).toContain('لا يوجد رصيد');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
