import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(), adjust: vi.fn(), create: vi.fn(), listProducts: vi.fn(), movements: vi.fn(),
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
  listAllProducts: mocks.listProducts,
  listStockMovements: mocks.movements,
  createProduct: mocks.create,
  updateProduct: mocks.update,
  adjustProductStock: mocks.adjust,
}));

import { ProductStockView } from '../src/features/products';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.listProducts.mockResolvedValue({
    items: [product], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
  });
  mocks.movements.mockResolvedValue({ items: [], totalPages: 1 });
});

describe('ProductStockView', () => {
  it('announces product and movement loading states', async () => {
    mocks.listProducts.mockReturnValue(new Promise(() => undefined));
    mocks.movements.mockReturnValue(new Promise(() => undefined));
    render(<QueryClientProvider client={new QueryClient()}><ProductStockView /></QueryClientProvider>);
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });

    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getByRole('status', { name: 'جارٍ تحميل المنتجات…' })).toBeDefined();
    expect(screen.getByRole('status', { name: 'جارٍ تحميل حركات المخزون…' })).toBeDefined();
  });

  it('edits product facts and posts an explicit stock correction', async () => {
    mocks.update.mockResolvedValue(product);
    mocks.adjust.mockResolvedValue({ product, movementId: 8 });
    const queryClient = new QueryClient();
    queryClient.setQueryData(['erp-reports', 'existing'], {});
    render(<QueryClientProvider client={queryClient}><ProductStockView /></QueryClientProvider>);
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findAllByText('شامبو');
    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }));
    fireEvent.change(screen.getByLabelText('سعر البيع'), { target: { value: '110' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(4, expect.objectContaining({ branchId: 2, sellingPrice: '110' })));
    expect(await screen.findByRole('status', { name: 'تم حفظ المنتج.' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'تسوية' }));
    fireEvent.change(screen.getByLabelText('تغيير الكمية'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(mocks.adjust).toHaveBeenCalledWith(4, expect.objectContaining({ branchId: 2, quantityDelta: 3, reason: 'count_correction' })));
    expect(await screen.findByRole('status', { name: 'تم حفظ تسوية المخزون.' })).toBeDefined();
    expect(queryClient.getQueryState(['erp-reports', 'existing'])?.isInvalidated).toBe(true);
  });

  it('keeps product edit and stock adjustment panels open while their request is pending', async () => {
    mocks.update.mockReturnValue(new Promise(() => undefined));
    const { unmount } = render(<QueryClientProvider client={new QueryClient()}><ProductStockView /></QueryClientProvider>);
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findAllByText('شامبو');
    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'إلغاء' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('الفرع').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('اسم المنتج').hasAttribute('disabled')).toBe(true);

    unmount();
    mocks.update.mockReset();
    mocks.adjust.mockReturnValue(new Promise(() => undefined));
    render(<QueryClientProvider client={new QueryClient()}><ProductStockView /></QueryClientProvider>);
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findAllByText('شامبو');
    fireEvent.click(screen.getByRole('button', { name: 'تسوية' }));
    fireEvent.change(screen.getByLabelText('تغيير الكمية'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(mocks.adjust).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'إلغاء' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('الفرع').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('تغيير الكمية').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('اسم المنتج')).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'إضافة منتج' })).toHaveProperty('disabled', true);
  });

  it('requires confirmation before deactivating a product', async () => {
    mocks.update.mockResolvedValue({ ...product, isActive: false });
    render(<QueryClientProvider client={new QueryClient()}><ProductStockView /></QueryClientProvider>);
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findAllByText('شامبو');

    fireEvent.click(screen.getByRole('button', { name: 'إيقاف' }));
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد إيقاف المنتج' }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(4, {
      branchId: 2,
      isActive: false,
    }));
  });

  it('locks a pre-opened deactivation confirmation while another product command is pending', async () => {
    mocks.update.mockReturnValue(new Promise(() => undefined));
    render(<QueryClientProvider client={new QueryClient()}><ProductStockView /></QueryClientProvider>);
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findAllByText('شامبو');
    fireEvent.click(screen.getByRole('button', { name: 'إيقاف' }));
    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const dialog = screen.getByRole('dialog', { name: 'إيقاف المنتج' });
    const confirm = within(dialog).getByRole('button', { name: 'تأكيد إيقاف المنتج' });
    const dismiss = within(dialog).getByRole('button', { name: 'إلغاء' });
    expect(confirm).toHaveProperty('disabled', true);
    expect(dismiss).toHaveProperty('disabled', true);
    fireEvent.click(confirm);
    fireEvent.click(dismiss);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(dialog).toBeDefined();
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
