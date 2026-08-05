import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(), adjust: vi.fn(), create: vi.fn(),
}));
const product = {
  id: 4, branchId: 2, name: 'شامبو', description: 'للشعر', sellingPrice: '100.00',
  lastPurchaseCost: '60.00', lowStockThreshold: 2, isActive: true, quantity: 5,
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
};
vi.mock('../src/features/catalog', () => ({
  listCatalogBranches: vi.fn(async () => ({ items: [{ id: 2, name: 'الرئيسي' }, { id: 3, name: 'الفرع الثاني' }], totalPages: 1 })),
}));
vi.mock('../src/features/products/api/products-api', () => ({
  listAllProducts: vi.fn(async () => ({ items: [product], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } })),
  listStockMovements: vi.fn(async () => ({ items: [], totalPages: 1 })),
  createProduct: mocks.create,
  updateProduct: mocks.update,
  adjustProductStock: mocks.adjust,
}));

import { ProductStockView } from '../src/features/products';

afterEach(cleanup);

describe('ProductStockView', () => {
  it('edits product facts and posts an explicit stock correction', async () => {
    mocks.update.mockResolvedValue(product);
    mocks.adjust.mockResolvedValue({ product, movementId: 8 });
    render(<QueryClientProvider client={new QueryClient()}><ProductStockView /></QueryClientProvider>);
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findAllByText('شامبو');
    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }));
    fireEvent.change(screen.getByLabelText('سعر البيع'), { target: { value: '110' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(4, expect.objectContaining({ branchId: 2, sellingPrice: '110' })));

    fireEvent.click(screen.getByRole('button', { name: 'تسوية' }));
    fireEvent.change(screen.getByLabelText('تغيير الكمية'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(mocks.adjust).toHaveBeenCalledWith(4, expect.objectContaining({ branchId: 2, quantityDelta: 3, reason: 'count_correction' })));
  });

  it('clears branch-specific state when the branch changes', async () => {
    render(<QueryClientProvider client={new QueryClient()}><ProductStockView /></QueryClientProvider>);
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findAllByText('شامبو');

    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }));
    fireEvent.click(screen.getByRole('button', { name: 'تسوية' }));
    fireEvent.change(screen.getByLabelText('تصفية الحركات حسب المنتج'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '3' } });

    expect(screen.queryByRole('button', { name: 'حفظ التعديل' })).toBeNull();
    expect(screen.queryByLabelText('تغيير الكمية')).toBeNull();
    expect((screen.getByLabelText('تصفية الحركات حسب المنتج') as HTMLSelectElement).value).toBe('');
  });
});
