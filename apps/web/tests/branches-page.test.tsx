import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { BranchesView } from '../src/features/branches';
import { ApiError } from '../src/lib/api/client';

const { listBranchesMock, createBranchMock, updateBranchMock, deleteBranchMock } = vi.hoisted(() => ({
  listBranchesMock: vi.fn(),
  createBranchMock: vi.fn(),
  updateBranchMock: vi.fn(),
  deleteBranchMock: vi.fn(),
}));

vi.mock('../src/features/branches/api/branches-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listBranches: listBranchesMock,
  createBranch: createBranchMock,
  updateBranch: updateBranchMock,
  deleteBranch: deleteBranchMock,
}));

const cairo = {
  id: 1,
  name: 'فرع القاهرة',
  location: 'مدينة نصر',
  latitude: 30.0561,
  longitude: 31.3301,
  gpsAccuracyMeters: 8,
  attendanceRadiusMeters: 50,
  hasEverBeenReferenced: false,
  createdAt: '2026-07-17T10:00:00.000Z',
  updatedAt: '2026-07-17T10:00:00.000Z',
};

const page = (items: unknown[], meta?: Partial<{ page: number; total: number; totalPages: number }>) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...meta },
});

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BranchesView />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BranchesView', () => {
  test('lists branches with name and location', async () => {
    listBranchesMock.mockResolvedValue(page([cairo]));
    renderView();

    await waitFor(() => expect(screen.getByText('فرع القاهرة')).toBeDefined());
    expect(screen.getByText('مدينة نصر')).toBeDefined();
  });

  test('shows an Arabic empty state when there are no branches', async () => {
    listBranchesMock.mockResolvedValue(page([]));
    renderView();

    await waitFor(() => expect(screen.getByText('لا توجد فروع بعد')).toBeDefined());
  });

  test('submitting the search form queries with the search term', async () => {
    listBranchesMock.mockResolvedValue(page([cairo]));
    renderView();
    await waitFor(() => expect(listBranchesMock).toHaveBeenCalled());

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'القاهرة' } });
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));

    await waitFor(() => {
      expect(listBranchesMock.mock.calls.at(-1)?.[0]).toMatchObject({ search: 'القاهرة', page: 1 });
    });
  });

  test('creates a branch from the new-branch form', async () => {
    listBranchesMock.mockResolvedValue(page([]));
    createBranchMock.mockResolvedValue({ ...cairo, id: 2 });
    renderView();
    await waitFor(() => expect(listBranchesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'إضافة فرع' }));
    fireEvent.change(screen.getByLabelText(/اسم الفرع/), { target: { value: 'فرع الجيزة' } });
    fireEvent.change(screen.getByLabelText(/الموقع/), { target: { value: 'الدقي' } });
    fireEvent.change(screen.getByLabelText(/خط العرض/), { target: { value: '30.03' } });
    fireEvent.change(screen.getByLabelText(/خط الطول/), { target: { value: '31.21' } });
    fireEvent.change(screen.getByLabelText(/دقة التحديد/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/نطاق الحضور/), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الفرع' }));

    await waitFor(() => {
      expect(createBranchMock.mock.calls[0]?.[0]).toEqual({
        name: 'فرع الجيزة',
        location: 'الدقي',
        latitude: 30.03,
        longitude: 31.21,
        gpsAccuracyMeters: 10,
        attendanceRadiusMeters: 75,
      });
    });
  });

  test('shows the Arabic duplicate-name error from the API', async () => {
    listBranchesMock.mockResolvedValue(page([cairo]));
    createBranchMock.mockRejectedValue(
      new ApiError(409, { code: 'BRANCH_NAME_EXISTS', message: 'اسم الفرع مستخدم بالفعل' }),
    );
    renderView();
    await waitFor(() => expect(listBranchesMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'إضافة فرع' }));
    fireEvent.change(screen.getByLabelText(/اسم الفرع/), { target: { value: 'فرع القاهرة' } });
    fireEvent.change(screen.getByLabelText(/الموقع/), { target: { value: 'مدينة نصر' } });
    fireEvent.change(screen.getByLabelText(/خط العرض/), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/خط الطول/), { target: { value: '31' } });
    fireEvent.change(screen.getByLabelText(/دقة التحديد/), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/نطاق الحضور/), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الفرع' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('اسم الفرع مستخدم بالفعل');
    });
  });

  test('switching from editing one branch to another shows and targets the new branch', async () => {
    const giza = { ...cairo, id: 2, name: 'فرع الجيزة', location: 'الدقي' };
    listBranchesMock.mockResolvedValue(page([cairo, giza]));
    updateBranchMock.mockResolvedValue(giza);
    renderView();
    await waitFor(() => expect(screen.getByText('فرع الجيزة')).toBeDefined());

    fireEvent.click(within(screen.getByText('فرع القاهرة').closest('tr')!).getByRole('button', { name: 'تعديل' }));
    expect((screen.getByLabelText(/اسم الفرع/) as HTMLInputElement).value).toBe('فرع القاهرة');

    fireEvent.click(within(screen.getByText('فرع الجيزة').closest('tr')!).getByRole('button', { name: 'تعديل' }));
    expect((screen.getByLabelText(/اسم الفرع/) as HTMLInputElement).value).toBe('فرع الجيزة');

    fireEvent.change(screen.getByLabelText(/اسم الفرع/), { target: { value: 'فرع الجيزة الجديد' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الفرع' }));

    await waitFor(() => expect(updateBranchMock).toHaveBeenCalledTimes(1));
    expect(updateBranchMock.mock.calls[0]?.[0]).toBe(2);
    expect(updateBranchMock.mock.calls[0]?.[1]).toMatchObject({ name: 'فرع الجيزة الجديد' });
  });

  test('deletes a branch only after explicit confirmation', async () => {
    listBranchesMock.mockResolvedValue(page([cairo]));
    deleteBranchMock.mockResolvedValue(undefined);
    renderView();
    await waitFor(() => expect(screen.getByText('فرع القاهرة')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'حذف' }));
    expect(deleteBranchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الحذف' }));
    await waitFor(() => expect(deleteBranchMock.mock.calls[0]?.[0]).toBe(1));
  });

  test('requests the next page from the pagination controls', async () => {
    listBranchesMock.mockResolvedValue(page([cairo], { total: 45, totalPages: 3 }));
    renderView();
    await waitFor(() => expect(screen.getByText('فرع القاهرة')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));

    await waitFor(() => {
      const params = listBranchesMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ page: 2 });
      expect(params).not.toHaveProperty('pageSize');
    });
  });
});
