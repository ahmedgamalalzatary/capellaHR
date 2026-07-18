import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  listAdvances: vi.fn(),
  createAdvance: vi.fn(),
  updateAdvance: vi.fn(),
  deleteAdvance: vi.fn(),
  listEmployees: vi.fn(),
  listBranches: vi.fn(),
}));

vi.mock('../src/features/advances/api/advances-api', () => ({
  listAdvances: mocks.listAdvances,
  createAdvance: mocks.createAdvance,
  updateAdvance: mocks.updateAdvance,
  deleteAdvance: mocks.deleteAdvance,
}));

vi.mock('../src/features/employees/api/employees-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listEmployees: mocks.listEmployees,
}));

vi.mock('../src/features/branches/api/branches-api', () => ({
  listBranches: mocks.listBranches,
}));

import { AdvancesView } from '../src/features/advances/components/advances-view';

const advance = {
  id: 4,
  employeeId: 1,
  employeeCode: 1001,
  employeeName: 'أحمد جمال',
  branchId: 3,
  branchName: 'فرع القاهرة',
  amount: '1000.00',
  installmentCount: 3,
  startMonth: '2026-07',
  employeeDeletedAt: null,
  installments: [
    { id: 41, ordinal: 1, payrollMonth: '2026-07', amount: '333.33' },
    { id: 42, ordinal: 2, payrollMonth: '2026-08', amount: '333.33' },
    { id: 43, ordinal: 3, payrollMonth: '2026-09', amount: '333.34' },
  ],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const readOnly = {
  ...advance,
  id: 5,
  employeeId: 2,
  employeeCode: 1002,
  employeeName: 'منى علي',
  employeeDeletedAt: '2026-07-05T00:00:00.000Z',
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
      <AdvancesView />
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

beforeEach(() => {
  mocks.listAdvances.mockResolvedValue(pageOf([advance, readOnly]));
  mocks.listEmployees.mockResolvedValue(
    pageOf([{ id: 1, employeeCode: 1001, fullName: 'أحمد جمال' }]),
  );
  mocks.listBranches.mockResolvedValue(pageOf([{ id: 3, name: 'فرع القاهرة' }]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdvancesView', () => {
  test('lists advances with amount, installment count, and start month', async () => {
    renderView();
    const row = (await screen.findByText('أحمد جمال')).closest('tr')!;
    expect(within(row).getByText('1001')).toBeDefined();
    expect(within(row).getByText(/1000\.00/)).toBeDefined();
    expect(within(row).getByText('3 أقساط')).toBeDefined();
    expect(within(row).getByText('2026-07')).toBeDefined();
  });

  test('expands the installment schedule with the rounding remainder last', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'الأقساط' }));
    expect(screen.getByText('2026-09')).toBeDefined();
    expect(screen.getAllByText(/333\.33/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/333\.34/)).toBeDefined();
  });

  test('creates an advance with a full schedule payload', async () => {
    mocks.createAdvance.mockResolvedValue(advance);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة سلفة' }));
    await screen.findByRole('option', { name: /أحمد جمال/ });
    fireEvent.change(screen.getByLabelText(/الموظف/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/المبلغ/), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText(/عدد الأقساط/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/شهر البداية/), { target: { value: '2026-07' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(mocks.createAdvance).toHaveBeenCalledWith({
        employeeId: 1,
        amount: '1000',
        installmentCount: 3,
        startMonth: '2026-07',
      }),
    );
  });

  test('edits the schedule but never the employee', async () => {
    mocks.updateAdvance.mockResolvedValue(advance);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'تعديل' }));
    expect(screen.queryByLabelText(/الموظف/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/عدد الأقساط/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() =>
      expect(mocks.updateAdvance).toHaveBeenCalledWith(4, {
        amount: '1000.00',
        installmentCount: 2,
        startMonth: '2026-07',
      }),
    );
  });

  test('deletes an advance after an inline confirmation', async () => {
    mocks.deleteAdvance.mockResolvedValue(undefined);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'حذف' }));
    expect(mocks.deleteAdvance).not.toHaveBeenCalled();
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'تأكيد الحذف' }));
    await waitFor(() => expect(mocks.deleteAdvance).toHaveBeenCalledWith(4));
  });

  test('a deleted-employee advance is read-only', async () => {
    renderView();
    await screen.findByText('منى علي');
    const row = rowOf('منى علي');
    expect(within(row).queryByRole('button', { name: 'تعديل' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'حذف' })).toBeNull();
    expect(within(row).getByText('موظف محذوف')).toBeDefined();
  });

  test('surfaces the Arabic server error when an installment is finalized', async () => {
    mocks.deleteAdvance.mockRejectedValue(new ApiError(409, {
      code: 'ADVANCE_PAYROLL_FINALIZED',
      message: 'تعذر تنفيذ عملية السلفة',
    }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'حذف' }));
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'تأكيد الحذف' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'تعذر تنفيذ عملية السلفة',
    );
  });

  test('surfaces an employee-load failure in the create form with a retry action', async () => {
    mocks.listEmployees.mockRejectedValue(
      new ApiError(500, { code: 'INTERNAL', message: 'حدث خطأ في الخادم' }),
    );
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة سلفة' }));
    expect(await screen.findByText('تعذر تحميل الموظفين')).toBeDefined();
    expect(screen.getByLabelText(/الموظف/)).toHaveProperty('disabled', true);
    mocks.listEmployees.mockResolvedValue(
      pageOf([{ id: 1, employeeCode: 1001, fullName: 'أحمد جمال' }]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByRole('option', { name: /أحمد جمال/ })).toBeDefined();
    expect(screen.getByLabelText(/الموظف/)).toHaveProperty('disabled', false);
  });

  test('shows an Arabic empty state when no advances exist', async () => {
    mocks.listAdvances.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا توجد سلف')).toBeDefined();
  });

  test('filters by month, branch, and search', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(screen.getByLabelText('تصفية حسب الشهر'), { target: { value: '2026-08' } });
    fireEvent.change(screen.getByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'أحمد' } });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
    await waitFor(() => {
      expect(mocks.listAdvances).toHaveBeenLastCalledWith(
        expect.objectContaining({ payrollMonth: '2026-08', branchId: 3, search: 'أحمد', page: 1 }),
      );
    });
  });
});
