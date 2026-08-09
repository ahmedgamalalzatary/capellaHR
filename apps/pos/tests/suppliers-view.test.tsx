import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createSupplier: vi.fn(), updateSupplier: vi.fn(), postPurchase: vi.fn(), cancelPurchase: vi.fn(), listPurchases: vi.fn(), listSuppliers: vi.fn(), listProducts: vi.fn() }));
const supplier = { id: 3, branchId: 2, name: 'مورد النيل', phone: '0100', notes: null, isActive: true, createdAt: '2026-08-05T10:00:00Z', updatedAt: '2026-08-05T10:00:00Z' };
const purchase = { id: 9, branchId: 2, supplierId: 3, supplierName: 'مورد النيل', status: 'posted', purchaseDate: '2026-08-05', total: '25.00', actingAccountId: 1, actingUsername: 'admin', cancelledAt: null, cancelledByAccountId: null, cancellationReason: null, correctsPurchaseId: null, correctedByPurchaseId: null, createdAt: '2026-08-05T10:00:00Z', lines: [{ id: 1, purchaseId: 9, branchId: 2, productId: 4, productNameSnapshot: 'شامبو', quantity: 2, unitCost: '12.50', previousUnitCost: '8.00', lineTotal: '25.00', postedBalanceAfter: 7, cancellationBalanceAfter: null }] };
vi.mock('../src/features/catalog', () => ({ listCatalogBranches: vi.fn(async () => ({ items: [{ id: 2, name: 'الرئيسي' }, { id: 5, name: 'الفرع الثاني' }] })) }));
vi.mock('../src/features/products/api/products-api', () => ({ listAllProducts: mocks.listProducts }));
vi.mock('../src/features/suppliers/api/suppliers-api', () => ({
  listAllSuppliers: mocks.listSuppliers,
  createSupplier: mocks.createSupplier, updateSupplier: mocks.updateSupplier, postPurchase: mocks.postPurchase,
  listPurchases: mocks.listPurchases, cancelPurchase: mocks.cancelPurchase,
}));

import { SuppliersPurchasesView } from '../src/features/suppliers';
const renderView = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SuppliersPurchasesView /></QueryClientProvider>);

beforeEach(() => { mocks.listSuppliers.mockResolvedValue({ items: [supplier], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }); mocks.listProducts.mockImplementation(async (params: { isActive?: boolean }) => ({ items: params.isActive ? [{ id: 4, name: 'شامبو', isActive: true }] : [{ id: 4, name: 'شامبو', isActive: true }, { id: 8, name: 'منتج قديم', isActive: false }] })); mocks.listPurchases.mockResolvedValue({ items: [purchase], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }); mocks.createSupplier.mockResolvedValue(supplier); mocks.updateSupplier.mockResolvedValue(supplier); mocks.postPurchase.mockResolvedValue(purchase); mocks.cancelPurchase.mockResolvedValue({ ...purchase, status: 'cancelled' }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('SuppliersPurchasesView', () => {
  it('creates a supplier and posts a purchase with an exact visible total', async () => {
    renderView(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('اسم المورد'), { target: { value: 'مورد جديد' } }); fireEvent.click(screen.getByRole('button', { name: 'إضافة المورد' }));
    await waitFor(() => expect(mocks.createSupplier).toHaveBeenCalledWith(expect.objectContaining({ branchId: 2, name: 'مورد جديد' })));
    fireEvent.change(screen.getByLabelText('المورد للمشتريات'), { target: { value: '3' } }); fireEvent.change(screen.getByLabelText('المنتج'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '2' } }); fireEvent.change(screen.getByLabelText('تكلفة الوحدة'), { target: { value: '12.50' } });
    expect(screen.getByText('الإجمالي: 25.00 ج.م')).toBeDefined(); fireEvent.click(screen.getByRole('button', { name: 'ترحيل المشتريات' }));
    await waitFor(() => expect(mocks.postPurchase).toHaveBeenCalledWith(expect.objectContaining({ branchId: 2, supplierId: 3, lines: [{ productId: 4, quantity: 2, unitCost: '12.50' }] })));
    await waitFor(() => expect(mocks.listProducts.mock.calls.filter(([params]) => params.isActive === true)).toHaveLength(2));
  });

  it('shows immutable posted history and confirms one-time cancellation', async () => {
    renderView(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    const row = (await screen.findByText('#9')).closest('tr')!; expect(within(row).getByText('مُرحّلة')).toBeDefined();
    fireEvent.click(within(row).getByRole('button', { name: 'إلغاء المشتريات' })); fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'خطأ في الكمية' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' })); await waitFor(() => expect(mocks.cancelPurchase).toHaveBeenCalledWith(9, { branchId: 2, reason: 'خطأ في الكمية' }));
  });

  it('clears the cancellation reason whenever the dialog closes or reopens', async () => {
    renderView(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    const open = async () => fireEvent.click(within((await screen.findByText('#9')).closest('tr')!).getByRole('button', { name: 'إلغاء المشتريات' }));
    await open(); fireEvent.change(screen.getByLabelText('سبب الإلغاء'), { target: { value: 'سبب قديم' } }); fireEvent.click(screen.getByRole('button', { name: 'رجوع' }));
    await open(); expect((screen.getByLabelText('سبب الإلغاء') as HTMLInputElement).value).toBe('');
  });

  it('clears a selected supplier when that supplier is deactivated', async () => {
    const now = new Date('2026-08-09T21:30:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const randomUUID = vi.spyOn(crypto, 'randomUUID');
    mocks.listPurchases.mockResolvedValue({ items: [{ ...purchase, status: 'cancelled', cancellationReason: 'خطأ' }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    renderView(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    fireEvent.click(await screen.findByRole('button', { name: 'إنشاء تصحيح' }));
    const purchaseSupplier = screen.getByLabelText('المورد للمشتريات');
    const purchaseDate = screen.getByLabelText('تاريخ المشتريات') as HTMLInputElement;
    fireEvent.change(purchaseDate, { target: { value: '2020-01-01' } });
    const keyCallsBeforeDeactivation = randomUUID.mock.calls.length;
    const supplierRow = screen.getAllByRole('row').find((row) => (
      within(row).queryByText(supplier.name) && within(row).queryByRole('button', { name: 'إيقاف' })
    ))!;
    fireEvent.click(within(supplierRow).getByRole('button', { name: 'إيقاف' }));
    await waitFor(() => expect(mocks.updateSupplier).toHaveBeenCalledWith(3, {
      branchId: 2, isActive: false,
    }));
    await waitFor(() => expect((purchaseSupplier as HTMLSelectElement).value).toBe(''));
    expect(purchaseDate.value).toBe(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(now),
    );
    expect(screen.queryByText('تصحيح للمشتريات #9')).toBeNull();
    expect(screen.getAllByLabelText('المنتج')).toHaveLength(1);
    expect(randomUUID.mock.calls.length).toBe(keyCallsBeforeDeactivation + 1);
  });

  it('creates a lineage-linked correction from a cancelled purchase', async () => {
    mocks.listPurchases.mockResolvedValue({ items: [{ ...purchase, status: 'cancelled', cancellationReason: 'خطأ' }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    renderView(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    fireEvent.click(await screen.findByRole('button', { name: 'إنشاء تصحيح' }));
    expect(screen.getByText('تصحيح للمشتريات #9')).toBeDefined(); fireEvent.change(screen.getByLabelText('المنتج'), { target: { value: '4' } }); fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '2' } }); fireEvent.change(screen.getByLabelText('تكلفة الوحدة'), { target: { value: '12.50' } }); fireEvent.click(screen.getByRole('button', { name: 'ترحيل التصحيح' }));
    await waitFor(() => expect(mocks.postPurchase).toHaveBeenCalledWith(expect.objectContaining({ correctsPurchaseId: 9 })));
  });

  it('shows an unavailable marker when a posted stock balance is missing', async () => {
    mocks.listPurchases.mockResolvedValue({
      items: [{ ...purchase, lines: [{ ...purchase.lines[0], postedBalanceAfter: null }] }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    renderView();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    expect(await screen.findByText(/الرصيد بعد الترحيل: غير متاح/)).toBeDefined();
  });

  it('keeps inactive suppliers visible so they can be reactivated and used in history filters', async () => {
    mocks.listSuppliers.mockResolvedValue({ items: [{ ...supplier, isActive: false }], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
    renderView(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    expect(await screen.findByText('متوقف')).toBeDefined();
    expect(mocks.listSuppliers).toHaveBeenCalledWith({ branchId: 2, pageSize: 100 });
  });

  it('clears branch-specific draft, correction, and history state when the branch changes', async () => {
    mocks.listPurchases.mockResolvedValue({ items: [{ ...purchase, status: 'cancelled', cancellationReason: 'خطأ' }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    renderView(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    fireEvent.click(await screen.findByRole('button', { name: 'إنشاء تصحيح' }));
    fireEvent.change(screen.getByLabelText('تصفية حسب المورد'), { target: { value: '3' } });
    expect(screen.getByText('تصحيح للمشتريات #9')).toBeDefined();

    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '5' } });

    expect(screen.getByText('ترحيل مشتريات جديدة')).toBeDefined();
    expect((await screen.findByLabelText('المورد للمشتريات') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('تصفية حسب المورد') as HTMLSelectElement).value).toBe('');
  });

  it('rejects non-integer quantities without crashing the exact-total render', async () => {
    renderView(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findByLabelText('الكمية'); fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '1.5' } });
    expect(screen.getByText('الإجمالي: 0.00 ج.م')).toBeDefined();
    expect(screen.getByRole('button', { name: 'ترحيل المشتريات' }).hasAttribute('disabled')).toBe(true);
  });

  it('keeps inactive products out of entry while retaining them in history filters', async () => {
    renderView(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    const entry = await screen.findByLabelText('المنتج'); const history = screen.getByLabelText('تصفية حسب المنتج');
    expect(within(entry).queryByRole('option', { name: 'منتج قديم' })).toBeNull();
    expect(within(history).getByRole('option', { name: 'منتج قديم' })).toBeDefined();
  });

  it('shows supplier activation failures beside the lifecycle controls', async () => {
    mocks.updateSupplier.mockRejectedValueOnce(new Error('failed'));
    renderView(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    fireEvent.click(await screen.findByRole('button', { name: 'إيقاف' }));
    expect((await screen.findByRole('alert')).textContent).toContain('تعذر تنفيذ العملية');
  });
});
