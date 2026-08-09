import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
}));

vi.mock('../src/features/products/api/products-api', () => ({
  listSellableProducts: mocks.listSellableProducts,
}));

afterEach(cleanup);

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
});
