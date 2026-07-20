import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  listShiftAssignments: vi.fn(),
  updateShiftAssignment: vi.fn(),
  listBranches: vi.fn(),
}));

vi.mock('../src/features/shifts/api/shifts-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listShiftAssignments: mocks.listShiftAssignments,
  updateShiftAssignment: mocks.updateShiftAssignment,
}));

vi.mock('../src/features/branches/api/branches-api', () => ({
  listBranches: mocks.listBranches,
}));

import { ShiftsView } from '../src/features/shifts/components/shifts-view';

const ahmed = {
  employeeId: 1,
  employeeCode: 1001,
  employeeName: 'أحمد جمال',
  branchId: 3,
  branchName: 'فرع القاهرة',
  durationMinutes: 480,
};

const mona = {
  employeeId: 2,
  employeeCode: 1002,
  employeeName: 'منى علي',
  branchId: 3,
  branchName: 'فرع القاهرة',
  durationMinutes: 510,
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
      <ShiftsView />
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

const openEditor = async (name: string) => {
  fireEvent.click(within(rowOf(name)).getByRole('button', { name: 'تعديل' }));
  return screen.getByLabelText(/ساعات/) as HTMLInputElement;
};

beforeEach(() => {
  mocks.listShiftAssignments.mockResolvedValue(pageOf([ahmed, mona]));
  mocks.listBranches.mockResolvedValue(pageOf([{ id: 3, name: 'فرع القاهرة' }]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShiftsView', () => {
  test('lists each employee with code, branch, and the formatted duration', async () => {
    renderView();
    const row = (await screen.findByText('أحمد جمال')).closest('tr')!;
    expect(within(row).getByText('1001')).toBeDefined();
    expect(within(row).getByText('فرع القاهرة')).toBeDefined();
    expect(within(row).getByText('8:00')).toBeDefined();
    expect(within(rowOf('منى علي')).getByText('8:30')).toBeDefined();
  });

  test('shows an Arabic empty state when no assignments exist', async () => {
    mocks.listShiftAssignments.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا توجد تعيينات ورديات')).toBeDefined();
  });

  test('search resets to the first page and passes the term', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'منى' } });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
    await waitFor(() => {
      expect(mocks.listShiftAssignments).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'منى', page: 1 }),
      );
    });
  });

  test('filters by branch', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(await screen.findByLabelText('تصفية حسب الفرع'), { target: { value: '3' } });
    await waitFor(() => {
      expect(mocks.listShiftAssignments).toHaveBeenLastCalledWith(
        expect.objectContaining({ branchId: 3, page: 1 }),
      );
    });
  });

  test('shows a retryable error instead of an incomplete branch selector when branch options fail', async () => {
    mocks.listBranches
      .mockRejectedValueOnce(new ApiError(0, { code: 'NETWORK_ERROR', message: 'Branch options unavailable' }))
      .mockResolvedValueOnce(pageOf([{ id: 3, name: 'Cairo branch' }]));

    renderView();

    const branchError = await screen.findByRole('alert');
    expect(branchError.textContent).toContain('Branch options unavailable');
    expect(document.querySelector('select')).toBeNull();

    fireEvent.click(within(branchError).getByRole('button'));

    await waitFor(() => expect(mocks.listBranches).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('combobox')).toBeDefined();
  });

  test('edits one employee duration and sends whole minutes', async () => {
    mocks.updateShiftAssignment.mockResolvedValue({ ...ahmed, durationMinutes: 570 });
    renderView();
    await screen.findByText('أحمد جمال');

    const hours = await openEditor('أحمد جمال');
    expect(hours.value).toBe('8');
    expect((screen.getByLabelText(/دقائق/) as HTMLInputElement).value).toBe('0');

    fireEvent.change(hours, { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText(/دقائق/), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الوردية' }));

    await waitFor(() => expect(mocks.updateShiftAssignment).toHaveBeenCalledTimes(1));
    expect(mocks.updateShiftAssignment.mock.calls[0]?.[0]).toBe(1);
    expect(mocks.updateShiftAssignment.mock.calls[0]?.[1]).toEqual({ durationMinutes: 570 });
  });

  test('explains that a new duration applies from the next check-in', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    await openEditor('أحمد جمال');
    expect(screen.getByText(/تسجيل الحضور التالي/)).toBeDefined();
  });

  test('opening another employee replaces the editor with that employee values', async () => {
    renderView();
    await screen.findByText('أحمد جمال');

    expect((await openEditor('أحمد جمال')).value).toBe('8');
    const hours = await openEditor('منى علي');

    expect(screen.getAllByLabelText(/ساعات/)).toHaveLength(1);
    expect(hours.value).toBe('8');
    expect((screen.getByLabelText(/دقائق/) as HTMLInputElement).value).toBe('30');
  });

  test('submits a long duration and shows the API-owned range error', async () => {
    mocks.updateShiftAssignment.mockRejectedValue(new ApiError(400, {
      code: 'VALIDATION_ERROR',
      message: 'بيانات الطلب غير صالحة',
      fieldErrors: { durationMinutes: ['مدة الوردية يجب أن تكون بين دقيقة واحدة و12 ساعة'] },
    }));
    renderView();
    await screen.findByText('أحمد جمال');
    const hours = await openEditor('أحمد جمال');

    fireEvent.change(hours, { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/دقائق/), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الوردية' }));

    expect(await screen.findByText('مدة الوردية يجب أن تكون بين دقيقة واحدة و12 ساعة')).toBeDefined();
    expect(mocks.updateShiftAssignment).toHaveBeenCalledWith(1, { durationMinutes: 750 });
  });

  test('submits a zero duration and shows the API-owned range error', async () => {
    mocks.updateShiftAssignment.mockRejectedValue(new ApiError(400, {
      code: 'VALIDATION_ERROR',
      message: 'بيانات الطلب غير صالحة',
      fieldErrors: { durationMinutes: ['مدة الوردية يجب أن تكون بين دقيقة واحدة و12 ساعة'] },
    }));
    renderView();
    await screen.findByText('أحمد جمال');
    const hours = await openEditor('أحمد جمال');

    fireEvent.change(hours, { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/دقائق/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الوردية' }));

    expect(await screen.findByText('مدة الوردية يجب أن تكون بين دقيقة واحدة و12 ساعة')).toBeDefined();
    expect(mocks.updateShiftAssignment).toHaveBeenCalledWith(1, { durationMinutes: 0 });
  });

  test('surfaces the Arabic server error when the assignment is missing', async () => {
    mocks.updateShiftAssignment.mockRejectedValue(
      new ApiError(404, { code: 'SHIFT_ASSIGNMENT_NOT_FOUND', message: 'تعيين الوردية غير موجود' }),
    );
    renderView();
    await screen.findByText('أحمد جمال');
    await openEditor('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الوردية' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'تعيين الوردية غير موجود',
    );
  });

  test('closes the editor after a successful save', async () => {
    mocks.updateShiftAssignment.mockResolvedValue({ ...ahmed, durationMinutes: 480 });
    renderView();
    await screen.findByText('أحمد جمال');
    await openEditor('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الوردية' }));

    await waitFor(() => expect(screen.queryByLabelText(/ساعات/)).toBeNull());
  });

  test('paginates with the next button', async () => {
    mocks.listShiftAssignments.mockResolvedValue(pageOf([ahmed], { total: 30, totalPages: 2 }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      const params = mocks.listShiftAssignments.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ page: 2 });
      expect(params).not.toHaveProperty('pageSize');
    });
  });

  test('retries loading after a failure', async () => {
    mocks.listShiftAssignments.mockRejectedValueOnce(
      new ApiError(0, { code: 'NETWORK_ERROR', message: 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.' }),
    );
    renderView();
    const retry = await screen.findByRole('button', { name: 'إعادة المحاولة' });
    fireEvent.click(retry);
    expect(await screen.findByText('أحمد جمال')).toBeDefined();
  });
});
