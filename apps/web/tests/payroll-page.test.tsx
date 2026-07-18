import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  listPayrollMonths: vi.fn(),
  updateBaseSalary: vi.fn(),
  finalizePayroll: vi.fn(),
  finalizeBranchPayroll: vi.fn(),
  listEmployees: vi.fn(),
  listBranches: vi.fn(),
}));

vi.mock('../src/features/payroll/api/payroll-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listPayrollMonths: mocks.listPayrollMonths,
  updateBaseSalary: mocks.updateBaseSalary,
  finalizePayroll: mocks.finalizePayroll,
  finalizeBranchPayroll: mocks.finalizeBranchPayroll,
}));

vi.mock('../src/features/employees/api/employees-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listEmployees: mocks.listEmployees,
}));

vi.mock('../src/features/branches/api/branches-api', () => ({
  listBranches: mocks.listBranches,
}));

import { PayrollView } from '../src/features/payroll/components/payroll-view';

const payroll = {
  id: 7,
  employeeId: 1,
  employeeCode: 1001,
  employeeName: 'أحمد جمال',
  branchId: 3,
  branchName: 'فرع القاهرة',
  payrollMonth: '2026-06',
  status: 'open' as const,
  baseSalary: '6000.00',
  proratedBase: '6000.00',
  overtimeAmount: '150.00',
  bonusAmount: '200.00',
  attendanceDeductionAmount: '50.00',
  manualDeductionAmount: '25.00',
  advanceAmount: '500.00',
  priorNegativeCarry: '0.00',
  netSalary: '5775.00',
  eligibleWorkdays: 26,
  fullMonthWorkdays: 26,
  requiredMinutes: 12480,
  overtimeMinutes: 60,
  shortageMinutes: 20,
  finalizedAt: null,
};

const finalized = {
  ...payroll,
  id: 8,
  employeeId: 2,
  employeeCode: 1002,
  employeeName: 'منى علي',
  status: 'finalized' as const,
  finalizedAt: '2026-07-01T10:00:00.000Z',
};

const employee = {
  id: 1,
  employeeCode: 1001,
  fullName: 'أحمد جمال',
  monthlyBaseSalary: '6000.00',
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
      <PayrollView />
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

beforeEach(() => {
  mocks.listPayrollMonths.mockResolvedValue(pageOf([payroll, finalized]));
  mocks.listEmployees.mockResolvedValue(pageOf([employee]));
  mocks.listBranches.mockResolvedValue(pageOf([{ id: 3, name: 'فرع القاهرة' }]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PayrollView', () => {
  test('lists monthly payrolls with code, branch, net salary, and status', async () => {
    renderView();
    const row = (await screen.findByText('أحمد جمال')).closest('tr')!;
    expect(within(row).getByText('1001')).toBeDefined();
    expect(within(row).getByText('فرع القاهرة')).toBeDefined();
    expect(within(row).getByText(/5775\.00/)).toBeDefined();
    expect(within(row).getByText('مفتوح')).toBeDefined();
    expect(within(rowOf('منى علي')).getByText('معتمد نهائيًا')).toBeDefined();
  });

  test('requests the chosen month with search and branch filters', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(screen.getByLabelText('شهر الراتب'), { target: { value: '2026-05' } });
    fireEvent.change(screen.getByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'أحمد' } });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
    await waitFor(() => {
      expect(mocks.listPayrollMonths).toHaveBeenLastCalledWith(
        expect.objectContaining({ month: '2026-05', branchId: 3, search: 'أحمد', page: 1 }),
      );
    });
  });

  test('expands a payroll row into the full component breakdown', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'التفاصيل' }));
    expect(screen.getByText('الراتب الأساسي بعد الاستحقاق')).toBeDefined();
    expect(screen.getByText(/150\.00/)).toBeDefined();
    expect(screen.getByText(/500\.00/)).toBeDefined();
    expect(screen.getByText('الترحيل السالب السابق')).toBeDefined();
  });

  test('finalizes an open employee-month from its row', async () => {
    mocks.finalizePayroll.mockResolvedValue({ ...payroll, status: 'finalized' });
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'اعتماد' }));
    await waitFor(() => expect(mocks.finalizePayroll).toHaveBeenCalledWith(1, '2026-06'));
  });

  test('a finalized row offers no finalize action', async () => {
    renderView();
    await screen.findByText('منى علي');
    expect(within(rowOf('منى علي')).queryByRole('button', { name: 'اعتماد' })).toBeNull();
  });

  test('finalizes a whole branch month once a branch is selected', async () => {
    mocks.finalizeBranchPayroll.mockResolvedValue([]);
    renderView();
    await screen.findByText('أحمد جمال');
    expect(screen.queryByRole('button', { name: 'اعتماد رواتب الفرع' })).toBeNull();
    fireEvent.change(screen.getByLabelText('شهر الراتب'), { target: { value: '2026-06' } });
    fireEvent.change(screen.getByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: 'اعتماد رواتب الفرع' }));
    await waitFor(() => expect(mocks.finalizeBranchPayroll).toHaveBeenCalledWith(3, '2026-06'));
  });

  test('surfaces the Arabic error when attendance facts are unavailable', async () => {
    mocks.listPayrollMonths.mockRejectedValue(new ApiError(503, {
      code: 'PAYROLL_ATTENDANCE_UNAVAILABLE',
      message: 'تعذر التحقق من بيانات الحضور للراتب',
    }));
    renderView();
    expect(await screen.findByText('تعذر التحقق من بيانات الحضور للراتب')).toBeDefined();
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeDefined();
  });

  test('surfaces the Arabic error when finalization is rejected', async () => {
    mocks.finalizePayroll.mockRejectedValue(new ApiError(409, {
      code: 'PAYROLL_CHRONOLOGY_CONFLICT',
      message: 'يجب اعتماد الشهور الأقدم أولًا',
    }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'اعتماد' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'يجب اعتماد الشهور الأقدم أولًا',
    );
  });

  test('edits an employee base salary from the base-salary section', async () => {
    mocks.updateBaseSalary.mockResolvedValue({ employeeId: 1, amount: '7000.00' });
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'الرواتب الأساسية' }));
    const row = (await screen.findByText(/6000\.00/)).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تعديل الراتب' }));
    fireEvent.change(screen.getByLabelText(/الراتب الأساسي الشهري/), {
      target: { value: '7000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الراتب' }));
    await waitFor(() => expect(mocks.updateBaseSalary).toHaveBeenCalledWith(1, { amount: '7000' }));
  });

  test('rejects an invalid base salary before calling the API', async () => {
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: 'الرواتب الأساسية' }));
    const row = (await screen.findByText(/6000\.00/)).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تعديل الراتب' }));
    fireEvent.change(screen.getByLabelText(/الراتب الأساسي الشهري/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الراتب' }));
    expect(await screen.findByText('أدخل مبلغًا أكبر من صفر')).toBeDefined();
    expect(mocks.updateBaseSalary).not.toHaveBeenCalled();
  });

  test('shows an empty state when the month has no payrolls', async () => {
    mocks.listPayrollMonths.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا توجد رواتب لهذا الشهر')).toBeDefined();
  });

  test('paginates the payroll list with the next button', async () => {
    mocks.listPayrollMonths.mockResolvedValue(pageOf([payroll], { total: 30, totalPages: 2 }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      const params = mocks.listPayrollMonths.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ page: 2 });
      expect(params).not.toHaveProperty('pageSize');
    });
  });
});
