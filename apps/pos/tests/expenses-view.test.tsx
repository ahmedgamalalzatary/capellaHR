import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), correct: vi.fn(), list: vi.fn(), categories: vi.fn(), branches: vi.fn(async () => ({ items: [{ id: 2, name: 'الرئيسي' }], meta: { totalPages: 1 } })) }));
const expense = { id: 10, branchId: 2, categoryId: 4, categoryName: 'تشغيل', amount: '125.50', expenseDate: '2026-08-05', description: 'مستلزمات', actingAccountId: 7, actingUsername: 'admin', kind: 'expense', status: 'active', reversalOfId: null, supersedesId: null, correctionReason: null, createdAt: '2026-08-05T10:00:00Z' };
vi.mock('../src/features/catalog', () => ({
  listCatalogBranches: mocks.branches,
  listCategories: mocks.categories,
}));
vi.mock('../src/features/expenses/api/expenses-api', () => ({
  listExpenses: mocks.list,
  createExpense: mocks.create,
  correctExpense: mocks.correct,
}));

import { ExpensesView } from '../src/features/expenses';
import { ApiError } from '../src/lib/api/client';

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const mount = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><ExpensesView /></QueryClientProvider>);
  return queryClient;
};

describe('ExpensesView', () => {
  it('announces loading the expense history', async () => {
    mocks.categories.mockResolvedValue({ items: [], meta: { totalPages: 1 } });
    mocks.list.mockReturnValue(new Promise(() => undefined));
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });

    expect(screen.getByRole('status', { name: 'جارٍ تحميل المصروفات…' })).toBeDefined();
  });

  it('creates and filters branch-scoped expenses', async () => {
    mocks.categories.mockResolvedValue({ items: [{ id: 4, branchId: 2, type: 'expense', name: 'تشغيل', isActive: true }], meta: { totalPages: 1 } });
    mocks.list.mockResolvedValue({ items: [expense], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    mocks.create.mockResolvedValue(expense);
    const queryClient = mount();
    queryClient.setQueryData(['erp-reports', 'existing'], {});
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findAllByRole('option', { name: 'تشغيل' });
    fireEvent.change(screen.getByLabelText('التصنيف'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('المبلغ'), { target: { value: '125.50' } });
    fireEvent.change(screen.getByLabelText('تاريخ المصروف'), { target: { value: '2026-08-05' } });
    fireEvent.change(screen.getByLabelText('الوصف'), { target: { value: 'مستلزمات' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل المصروف' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ branchId: 2, categoryId: 4, amount: '125.50' })));
    expect(await screen.findByRole('status', { name: 'تم تسجيل المصروف.' })).toBeDefined();
    fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-08-01' } });
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ branchId: 2, fromDate: '2026-08-01' })));
    expect(queryClient.getQueryState(['erp-reports', 'existing'])?.isInvalidated).toBe(true);
  });

  it('shows immutable lineage and explicitly corrects an active original', async () => {
    mocks.categories.mockResolvedValue({ items: [{ id: 4, branchId: 2, type: 'expense', name: 'تشغيل', isActive: true }], meta: { totalPages: 1 } });
    mocks.list.mockResolvedValue({ items: [expense], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    mocks.correct.mockResolvedValue({ original: { ...expense, status: 'corrected' }, reversal: { ...expense, id: 11, kind: 'reversal' }, replacement: { ...expense, id: 12, amount: '100.00' } });
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findByText('مستلزمات');
    fireEvent.click(screen.getByRole('button', { name: 'تصحيح' }));
    fireEvent.change(screen.getByLabelText('المبلغ الصحيح'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('سبب التصحيح'), { target: { value: 'قيمة خاطئة' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد التصحيح' }));
    await waitFor(() => expect(mocks.correct).toHaveBeenCalledWith(10, expect.objectContaining({ branchId: 2, amount: '100', reason: 'قيمة خاطئة' })));
  });

  it('keeps the expense correction open while posting', async () => {
    mocks.categories.mockResolvedValue({ items: [{ id: 4, branchId: 2, type: 'expense', name: 'تشغيل', isActive: true }], meta: { totalPages: 1 } });
    mocks.list.mockResolvedValue({ items: [expense], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    mocks.correct.mockReturnValue(new Promise(() => undefined));
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findByText('مستلزمات');
    fireEvent.click(screen.getByRole('button', { name: 'تصحيح' }));
    fireEvent.change(screen.getByLabelText('المبلغ الصحيح'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('سبب التصحيح'), { target: { value: 'قيمة خاطئة' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد التصحيح' }));
    await waitFor(() => expect(mocks.correct).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'إلغاء' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('الفرع').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('المبلغ الصحيح').hasAttribute('disabled')).toBe(true);
  });

  it('requires a new active category when the original category was retired', async () => {
    mocks.categories.mockResolvedValue({ items: [{ id: 5, branchId: 2, type: 'expense', name: 'جديد', isActive: true }], meta: { totalPages: 1 } });
    mocks.list.mockResolvedValue({ items: [expense], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    mount(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findByText('مستلزمات'); fireEvent.click(screen.getByRole('button', { name: 'تصحيح' }));
    fireEvent.change(screen.getByLabelText('سبب التصحيح'), { target: { value: 'تصنيف متقاعد' } });
    expect((screen.getByLabelText('التصنيف') as HTMLSelectElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'تأكيد التصحيح' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows an active correction replacement to be corrected again', async () => {
    mocks.categories.mockResolvedValue({ items: [{ id: 4, branchId: 2, type: 'expense', name: 'تشغيل', isActive: true }], meta: { totalPages: 1 } });
    mocks.list.mockResolvedValue({ items: [{ ...expense, id: 12, supersedesId: 10 }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    mount(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    await screen.findByText('مستلزمات'); expect(screen.getByRole('button', { name: 'تصحيح' })).toBeTruthy();
  });

  it('clears draft facts when changing branches or cancelling a correction', async () => {
    mocks.categories.mockResolvedValue({ items: [{ id: 4, branchId: 2, type: 'expense', name: 'تشغيل', isActive: true }], meta: { totalPages: 1 } });
    mocks.list.mockResolvedValue({ items: [expense], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    mount(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } }); await screen.findByText('مستلزمات');
    fireEvent.click(screen.getByRole('button', { name: 'تصحيح' })); fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
    expect((screen.getByLabelText('المبلغ') as HTMLInputElement).value).toBe(''); expect((screen.getByLabelText('الوصف') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('المبلغ'), { target: { value: '20' } }); fireEvent.change(screen.getByLabelText('الوصف'), { target: { value: 'draft' } }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '' } }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    expect((screen.getByLabelText('المبلغ') as HTMLInputElement).value).toBe(''); expect((screen.getByLabelText('الوصف') as HTMLInputElement).value).toBe('');
  });

  it('loads every category page and keeps retired categories in history filters', async () => {
    mocks.categories.mockImplementation(async ({ page, isActive }: { page?: number; isActive?: boolean }) => ({
      items: page === 2 ? [{ id: 6, branchId: 2, type: 'expense', name: 'صفحة ثانية', isActive: true }] : [{ id: 5, branchId: 2, type: 'expense', name: isActive ? 'نشط' : 'متقاعد', isActive: isActive === true }],
      meta: { page: page ?? 1, pageSize: 100, total: 2, totalPages: 2 },
    }));
    mocks.list.mockResolvedValue({ items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    mount(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    expect(await screen.findAllByRole('option', { name: 'صفحة ثانية' })).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'متقاعد' })).toBeTruthy();
  });

  it('does not carry a failed create error into correction mode', async () => {
    mocks.categories.mockResolvedValue({ items: [{ id: 4, branchId: 2, type: 'expense', name: 'تشغيل', isActive: true }], meta: { totalPages: 1 } });
    mocks.list.mockResolvedValue({ items: [expense], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    mocks.create.mockRejectedValue(new ApiError(500, { code: 'CREATE_FAILED', message: 'فشل الإنشاء' }));
    mount(); await screen.findByRole('option', { name: 'الرئيسي' }); fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } }); await screen.findByText('مستلزمات');
    fireEvent.change(screen.getByLabelText('التصنيف'), { target: { value: '4' } }); fireEvent.change(screen.getByLabelText('المبلغ'), { target: { value: '10' } }); fireEvent.change(screen.getByLabelText('الوصف'), { target: { value: 'x' } }); fireEvent.click(screen.getByRole('button', { name: 'تسجيل المصروف' }));
    expect(await screen.findByText('فشل الإنشاء')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'تصحيح' }));
    expect(screen.queryByText('فشل الإنشاء')).toBeNull();
  });

  it('loads every branch page for the branch selector', async () => {
    mocks.branches.mockImplementation(async (page = 1) => ({ items: page === 1 ? [{ id: 2, name: 'الرئيسي' }] : [{ id: 3, name: 'فرع ثانٍ' }], meta: { totalPages: 2 } }));
    mount();
    expect(await screen.findByRole('option', { name: 'فرع ثانٍ' })).toBeTruthy();
  });

  it('offers retry when branch options fail to load', async () => {
    mocks.branches.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({ items: [{ id: 2, name: 'الرئيسي' }], meta: { totalPages: 1 } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByRole('option', { name: 'الرئيسي' })).toBeTruthy();
  });
});
