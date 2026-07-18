import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  listBonuses: vi.fn(),
  createBonus: vi.fn(),
  updateBonus: vi.fn(),
  deleteBonus: vi.fn(),
  listEmployees: vi.fn(),
  listBranches: vi.fn(),
}));

vi.mock('../src/features/bonuses/api/bonuses-api', () => ({
  listBonuses: mocks.listBonuses,
  createBonus: mocks.createBonus,
  updateBonus: mocks.updateBonus,
  deleteBonus: mocks.deleteBonus,
}));

vi.mock('../src/features/employees/api/employees-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listEmployees: mocks.listEmployees,
}));

vi.mock('../src/features/branches/api/branches-api', () => ({
  listBranches: mocks.listBranches,
}));

import { BonusesView } from '../src/features/bonuses/components/bonuses-view';

const bonus = {
  id: 5,
  employeeId: 1,
  employeeCode: 1001,
  employeeName: 'أحمد جمال',
  branchId: 3,
  branchName: 'فرع القاهرة',
  payrollMonth: '2026-06',
  amount: '250.00',
  employeeDeletedAt: null,
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

const readOnly = {
  ...bonus,
  id: 6,
  employeeId: 2,
  employeeCode: 1002,
  employeeName: 'منى علي',
  employeeDeletedAt: '2026-06-15T00:00:00.000Z',
};

const pageOf = (items: unknown[], meta: Partial<Record<string, number>> = {}) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...meta },
});

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BonusesView />
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

beforeEach(() => {
  mocks.listBonuses.mockResolvedValue(pageOf([bonus, readOnly]));
  mocks.listEmployees.mockResolvedValue(
    pageOf([{ id: 1, employeeCode: 1001, fullName: 'أحمد جمال' }]),
  );
  mocks.listBranches.mockResolvedValue(pageOf([{ id: 3, name: 'فرع القاهرة' }]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BonusesView', () => {
  test('lists bonuses with code, branch, month, and amount', async () => {
    renderView();
    const row = (await screen.findByText('أحمد جمال')).closest('tr')!;
    expect(within(row).getByText('1001')).toBeDefined();
    expect(within(row).getByText('فرع القاهرة')).toBeDefined();
    expect(within(row).getByText('2026-06')).toBeDefined();
    expect(within(row).getByText(/250\.00/)).toBeDefined();
  });

  test('filters by month, branch, and search', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(screen.getByLabelText('تصفية حسب الشهر'), { target: { value: '2026-05' } });
    fireEvent.change(screen.getByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'أحمد' } });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
    await waitFor(() => {
      expect(mocks.listBonuses).toHaveBeenLastCalledWith(
        expect.objectContaining({ payrollMonth: '2026-05', branchId: 3, search: 'أحمد', page: 1 }),
      );
    });
  });

  test('creates a bonus for an employee and month', async () => {
    mocks.createBonus.mockResolvedValue(bonus);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة مكافأة' }));
    await screen.findByRole('option', { name: /أحمد جمال/ });
    fireEvent.change(screen.getByLabelText(/الموظف/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/المبلغ/), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText(/شهر الراتب/), { target: { value: '2026-06' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(mocks.createBonus).toHaveBeenCalledWith({
        employeeId: 1,
        amount: '250',
        payrollMonth: '2026-06',
      }),
    );
  });

  test('rejects an invalid amount before calling the API', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة مكافأة' }));
    await screen.findByRole('option', { name: /أحمد جمال/ });
    fireEvent.change(screen.getByLabelText(/الموظف/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/المبلغ/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/شهر الراتب/), { target: { value: '2026-06' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    expect(await screen.findByText('أدخل مبلغًا أكبر من صفر')).toBeDefined();
    expect(mocks.createBonus).not.toHaveBeenCalled();
  });

  test('edits amount and month but never the employee', async () => {
    mocks.updateBonus.mockResolvedValue({ ...bonus, amount: '300.00' });
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'تعديل' }));
    expect(screen.queryByLabelText(/الموظف/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/المبلغ/), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(mocks.updateBonus).toHaveBeenCalledWith(5, {
        amount: '300',
        payrollMonth: '2026-06',
      }),
    );
  });

  test('deletes a bonus after an inline confirmation', async () => {
    mocks.deleteBonus.mockResolvedValue(undefined);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'حذف' }));
    expect(mocks.deleteBonus).not.toHaveBeenCalled();
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'تأكيد الحذف' }));
    await waitFor(() => expect(mocks.deleteBonus).toHaveBeenCalledWith(5));
  });

  test('a deleted-employee record is read-only', async () => {
    renderView();
    await screen.findByText('منى علي');
    const row = rowOf('منى علي');
    expect(within(row).queryByRole('button', { name: 'تعديل' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'حذف' })).toBeNull();
    expect(within(row).getByText('موظف محذوف')).toBeDefined();
  });

  test('surfaces the Arabic server error when the month is finalized', async () => {
    mocks.createBonus.mockRejectedValue(new ApiError(409, {
      code: 'BONUS_PAYROLL_FINALIZED',
      message: 'تعذر تنفيذ عملية الراتب',
    }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة مكافأة' }));
    await screen.findByRole('option', { name: /أحمد جمال/ });
    fireEvent.change(screen.getByLabelText(/الموظف/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/المبلغ/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/شهر الراتب/), { target: { value: '2026-06' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'تعذر تنفيذ عملية الراتب',
    );
  });

  test('surfaces an employee-load failure in the create form with a retry action', async () => {
    mocks.listEmployees.mockRejectedValue(
      new ApiError(500, { code: 'INTERNAL', message: 'حدث خطأ في الخادم' }),
    );
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة مكافأة' }));
    expect(await screen.findByText('تعذر تحميل الموظفين')).toBeDefined();
    expect(screen.getByLabelText(/الموظف/)).toHaveProperty('disabled', true);
    mocks.listEmployees.mockResolvedValue(
      pageOf([{ id: 1, employeeCode: 1001, fullName: 'أحمد جمال' }]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByRole('option', { name: /أحمد جمال/ })).toBeDefined();
    expect(screen.getByLabelText(/الموظف/)).toHaveProperty('disabled', false);
  });

  test('shows an Arabic empty state when no bonuses exist', async () => {
    mocks.listBonuses.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا توجد مكافآت')).toBeDefined();
  });

  test('paginates with the next button', async () => {
    mocks.listBonuses.mockResolvedValue(pageOf([bonus], { total: 30, totalPages: 2 }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      const params = mocks.listBonuses.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ page: 2 });
      expect(params).not.toHaveProperty('pageSize');
    });
  });

  test('retries loading after a failure', async () => {
    mocks.listBonuses.mockRejectedValueOnce(
      new ApiError(0, { code: 'NETWORK_ERROR', message: 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.' }),
    );
    renderView();
    const retry = await screen.findByRole('button', { name: 'إعادة المحاولة' });
    fireEvent.click(retry);
    expect(await screen.findByText('أحمد جمال')).toBeDefined();
  });
});
