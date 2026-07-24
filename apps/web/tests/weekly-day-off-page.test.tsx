import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  listWeeklyDayRecords: vi.fn(),
  convertWeeklyDayRecord: vi.fn(),
  revertWeeklyDayRecord: vi.fn(),
  listBranches: vi.fn(),
  listEmployees: vi.fn(),
}));

vi.mock('../src/features/weekly-day-off/api/weekly-day-off-api', () => ({
  listWeeklyDayRecords: mocks.listWeeklyDayRecords,
  convertWeeklyDayRecord: mocks.convertWeeklyDayRecord,
  revertWeeklyDayRecord: mocks.revertWeeklyDayRecord,
}));

vi.mock('../src/features/branches/api/branches-api', () => ({
  listBranches: mocks.listBranches,
}));

vi.mock('../src/features/employees/api/employees-api', () => ({
  listEmployees: mocks.listEmployees,
}));

import { WeeklyDayOffView } from '../src/features/weekly-day-off/components/weekly-day-off-view';

const absence = {
  id: 11,
  employeeId: 1,
  employeeCode: 1001,
  employeeName: 'أحمد جمال',
  branchId: 3,
  branchName: 'فرع القاهرة',
  attendanceDate: '2026-07-10',
  status: 'absence' as const,
  absenceRequiredMinutes: 480,
  requiredMinutes: 480,
  dayOffConvertedAt: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
};

const dayOff = {
  ...absence,
  id: 12,
  employeeId: 2,
  employeeCode: 1002,
  employeeName: 'منى علي',
  attendanceDate: '2026-07-03',
  status: 'weekly_day_off' as const,
  requiredMinutes: 0,
  dayOffConvertedAt: '2026-07-11T10:00:00.000Z',
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
      <WeeklyDayOffView />
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

beforeEach(() => {
  mocks.listWeeklyDayRecords.mockResolvedValue(pageOf([absence, dayOff]));
  mocks.listBranches.mockResolvedValue(pageOf([{ id: 3, name: 'فرع القاهرة' }]));
  mocks.listEmployees.mockResolvedValue(
    pageOf([
      { id: 1, employeeCode: 1001, fullName: 'أحمد جمال' },
      { id: 2, employeeCode: 1002, fullName: 'منى علي' },
    ]),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WeeklyDayOffView', () => {
  test('loads inactive employees for historical filtering', async () => {
    renderView();
    await waitFor(() => {
      expect(mocks.listEmployees).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, status: 'all' }),
      );
    });
  });

  test('lists each record with code, branch, date, status, and duration', async () => {
    renderView();
    const row = (await screen.findByText('أحمد جمال')).closest('tr')!;
    expect(within(row).getByText('1001')).toBeDefined();
    expect(within(row).getByText('فرع القاهرة')).toBeDefined();
    expect(within(row).getByText('2026-07-10')).toBeDefined();
    expect(within(row).getByText('غياب')).toBeDefined();
    expect(within(row).getByText('8:00')).toBeDefined();
    expect(within(rowOf('منى علي')).getByText('يوم راحة')).toBeDefined();
  });

  test('shows an Arabic empty state when no records exist', async () => {
    mocks.listWeeklyDayRecords.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا توجد سجلات غياب أو أيام راحة')).toBeDefined();
  });

  test('filtering by employee resets to the first page and passes the id', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(await screen.findByLabelText('تصفية حسب الموظف'), { target: { value: '2' } });
    await waitFor(() => {
      expect(mocks.listWeeklyDayRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ employeeId: 2, page: 1 }),
      );
    });
  });

  test('filters by branch and status', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(await screen.findByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    await waitFor(() => {
      expect(mocks.listWeeklyDayRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ branchId: 3, page: 1 }),
      );
    });
    fireEvent.change(screen.getByLabelText('تصفية حسب الحالة'), {
      target: { value: 'weekly_day_off' },
    });
    await waitFor(() => {
      expect(mocks.listWeeklyDayRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'weekly_day_off', branchId: 3, page: 1 }),
      );
    });
  });

  test('filters by a date range', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('إلى تاريخ'), { target: { value: '2026-07-15' } });
    await waitFor(() => {
      expect(mocks.listWeeklyDayRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ dateFrom: '2026-07-01', dateTo: '2026-07-15', page: 1 }),
      );
    });
  });

  test('converts an absence into a weekly day off', async () => {
    mocks.convertWeeklyDayRecord.mockResolvedValue({ ...absence, status: 'weekly_day_off' });
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'تعيين يوم راحة' }));
    await waitFor(() => expect(mocks.convertWeeklyDayRecord).toHaveBeenCalledWith(11));
  });

  test('reverts a weekly day off back to an absence', async () => {
    mocks.revertWeeklyDayRecord.mockResolvedValue({ ...dayOff, status: 'absence' });
    renderView();
    await screen.findByText('منى علي');
    fireEvent.click(within(rowOf('منى علي')).getByRole('button', { name: 'إعادة إلى غياب' }));
    await waitFor(() => expect(mocks.revertWeeklyDayRecord).toHaveBeenCalledWith(12));
  });

  test('an absence row has no revert action and a day-off row has no convert action', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    expect(within(rowOf('أحمد جمال')).queryByRole('button', { name: 'إعادة إلى غياب' })).toBeNull();
    expect(within(rowOf('منى علي')).queryByRole('button', { name: 'تعيين يوم راحة' })).toBeNull();
  });

  test('surfaces the Arabic server error when spacing rejects the conversion', async () => {
    mocks.convertWeeklyDayRecord.mockRejectedValue(new ApiError(409, {
      code: 'WEEKLY_DAY_OFF_SPACING_CONFLICT',
      message: 'يجب أن يفصل سبعة أيام على الأقل بين أيام الراحة',
    }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(rowOf('أحمد جمال')).getByRole('button', { name: 'تعيين يوم راحة' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'يجب أن يفصل سبعة أيام على الأقل بين أيام الراحة',
    );
  });

  test('a status transition resets the list to the first page', async () => {
    mocks.listWeeklyDayRecords.mockResolvedValue(pageOf([absence], { total: 30, totalPages: 2 }));
    mocks.convertWeeklyDayRecord.mockResolvedValue({ ...absence, status: 'weekly_day_off' });
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      expect(mocks.listWeeklyDayRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      );
    });
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'تعيين يوم راحة' }));
    await waitFor(() => {
      expect(mocks.listWeeklyDayRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 }),
      );
    });
  });

  test('paginates with the next button', async () => {
    mocks.listWeeklyDayRecords.mockResolvedValue(pageOf([absence], { total: 30, totalPages: 2 }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      const params = mocks.listWeeklyDayRecords.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ page: 2 });
      expect(params).not.toHaveProperty('pageSize');
    });
  });

  test('retries loading after a failure', async () => {
    mocks.listWeeklyDayRecords.mockRejectedValueOnce(
      new ApiError(0, { code: 'NETWORK_ERROR', message: 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.' }),
    );
    renderView();
    const retry = await screen.findByRole('button', { name: 'إعادة المحاولة' });
    fireEvent.click(retry);
    expect(await screen.findByText('أحمد جمال')).toBeDefined();
  });
});
