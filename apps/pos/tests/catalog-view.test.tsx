import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listCatalogBranches: vi.fn(),
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  listServices: vi.fn(),
  createService: vi.fn(),
  updateService: vi.fn(),
  listCommissionOverrides: vi.fn(),
  setCommissionOverride: vi.fn(),
  removeCommissionOverride: vi.fn(),
  listCatalogEmployeeOptions: vi.fn(),
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: mocks.getSession,
}));

vi.mock('../src/features/catalog/api/catalog-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...mocks,
  getSession: undefined,
}));

import { CatalogView } from '../src/features/catalog';

const hairCategory = {
  id: 1,
  branchId: 3,
  type: 'service' as const,
  name: 'شعر',
  isActive: true,
  hasEverBeenReferenced: false,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

const colouring = {
  id: 5,
  branchId: 3,
  categoryId: 1,
  name: 'صبغة',
  description: null,
  price: '150.00',
  commissionPercent: '10.00',
  isActive: true,
  categoryName: 'شعر',
  categoryIsActive: true,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
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
      <CatalogView />
    </QueryClientProvider>,
  );
}

/** Admin flows need a branch picked before anything is scoped. */
const pickBranch = async () => {
  // The select stays disabled until the branch list arrives.
  await screen.findByRole('option', { name: 'الفرع الرئيسي' });
  fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '3' } });
};

const openServicesTab = () => fireEvent.click(screen.getByRole('tab', { name: 'الخدمات' }));

beforeEach(() => {
  mocks.getSession.mockResolvedValue({ actor: { type: 'admin', accountId: 1 } });
  mocks.listCatalogBranches.mockResolvedValue(pageOf([{ id: 3, name: 'الفرع الرئيسي' }]));
  mocks.listCategories.mockResolvedValue(pageOf([hairCategory]));
  mocks.listServices.mockResolvedValue(pageOf([colouring]));
  mocks.listCommissionOverrides.mockResolvedValue([]);
  mocks.listCatalogEmployeeOptions.mockResolvedValue(
    pageOf([{ id: 7, fullName: 'سارة' }, { id: 8, fullName: 'منى' }]),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CatalogView branch scope', () => {
  test('asks an admin to choose a branch before loading anything', async () => {
    renderView();

    expect(await screen.findByText('اختر فرعًا لعرض الكتالوج')).toBeDefined();
    expect(mocks.listCategories).not.toHaveBeenCalled();
  });

  test('scopes every catalog read to the branch the admin chose', async () => {
    renderView();
    await pickBranch();

    await waitFor(() => {
      expect(mocks.listCategories.mock.calls.at(-1)?.[0]).toMatchObject({ branchId: 3 });
    });
  });

  test('derives the branch from the account for a cashier and hides the picker', async () => {
    mocks.getSession.mockResolvedValue({ actor: { type: 'cashier', accountId: 2, employeeId: 4 } });
    renderView();

    await waitFor(() => expect(mocks.listCategories).toHaveBeenCalled());
    expect(mocks.listCategories.mock.calls.at(-1)?.[0]?.branchId).toBeUndefined();
    expect(screen.queryByLabelText('الفرع')).toBeNull();
  });
});

describe('CatalogView categories', () => {
  test('lists categories with their Arabic type and state', async () => {
    renderView();
    await pickBranch();
    const row = (await screen.findByText('شعر')).closest('tr')!;

    expect(within(row).getByText('خدمات')).toBeDefined();
    expect(within(row).getByText('نشط')).toBeDefined();
  });

  test('shows an Arabic empty state when no category exists yet', async () => {
    mocks.listCategories.mockResolvedValue(pageOf([]));
    renderView();
    await pickBranch();

    expect(await screen.findByText('لا توجد تصنيفات بعد')).toBeDefined();
  });

  test('distinguishes an empty search result from an empty catalog', async () => {
    mocks.listCategories.mockResolvedValue(pageOf([]));
    renderView();
    await pickBranch();
    fireEvent.change(await screen.findByLabelText('بحث في التصنيفات'), { target: { value: 'شعر' } });

    expect(await screen.findByText('لا يوجد تصنيف مطابق')).toBeDefined();
  });

  test('surfaces the Arabic error when categories fail to load', async () => {
    mocks.listCategories.mockRejectedValue(
      new ApiError(500, { code: 'UNEXPECTED_ERROR', message: 'حدث خطأ غير متوقع. حاول مرة أخرى.' }),
    );
    renderView();
    await pickBranch();

    expect(await screen.findByText('تعذر تحميل التصنيفات')).toBeDefined();
  });

  test('creates a category with its type and the acting branch', async () => {
    mocks.createCategory.mockResolvedValue({ ...hairCategory, id: 2, name: 'أظافر' });
    renderView();
    await pickBranch();
    fireEvent.click(await screen.findByRole('button', { name: 'إضافة تصنيف' }));

    fireEvent.change(screen.getByLabelText(/^اسم التصنيف/), { target: { value: 'أظافر' } });
    fireEvent.change(screen.getByLabelText(/^النوع/), { target: { value: 'expense' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التصنيف' }));

    await waitFor(() => expect(mocks.createCategory).toHaveBeenCalledTimes(1));
    expect(mocks.createCategory.mock.calls[0]?.[0])
      .toEqual({ name: 'أظافر', type: 'expense', branchId: 3 });
  });

  test('surfaces the duplicate-name conflict from the server', async () => {
    mocks.createCategory.mockRejectedValue(
      new ApiError(409, { code: 'CATEGORY_NAME_EXISTS', message: 'اسم التصنيف مستخدم بالفعل في هذا النوع' }),
    );
    renderView();
    await pickBranch();
    fireEvent.click(await screen.findByRole('button', { name: 'إضافة تصنيف' }));

    fireEvent.change(screen.getByLabelText(/^اسم التصنيف/), { target: { value: 'شعر' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التصنيف' }));

    expect(await screen.findByText('اسم التصنيف مستخدم بالفعل في هذا النوع')).toBeDefined();
  });

  test('deactivates a category instead of deleting it', async () => {
    mocks.updateCategory.mockResolvedValue({ ...hairCategory, isActive: false });
    renderView();
    await pickBranch();
    const row = (await screen.findByText('شعر')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'إيقاف' }));

    await waitFor(() => expect(mocks.updateCategory).toHaveBeenCalledTimes(1));
    expect(mocks.updateCategory.mock.calls[0]?.slice(0, 2))
      .toEqual([1, { isActive: false, branchId: 3 }]);
  });

  test('confirms before deleting an unused category', async () => {
    mocks.deleteCategory.mockResolvedValue(undefined);
    renderView();
    await pickBranch();
    const row = (await screen.findByText('شعر')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'حذف' }));

    expect(mocks.deleteCategory).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'تأكيد الحذف' }));

    await waitFor(() => expect(mocks.deleteCategory).toHaveBeenCalledWith(1, 3));
  });

  test('explains that a used category can only be deactivated', async () => {
    mocks.deleteCategory.mockRejectedValue(new ApiError(409, {
      code: 'CATEGORY_IN_USE',
      message: 'لا يمكن حذف تصنيف مستخدم؛ يمكن إيقافه بدلًا من ذلك',
    }));
    renderView();
    await pickBranch();
    const row = (await screen.findByText('شعر')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'حذف' }));
    fireEvent.click(await screen.findByRole('button', { name: 'تأكيد الحذف' }));

    expect(await screen.findByText('لا يمكن حذف تصنيف مستخدم؛ يمكن إيقافه بدلًا من ذلك')).toBeDefined();
  });
});

describe('CatalogView services', () => {
  test('lists services with their fixed price, commission and category', async () => {
    renderView();
    await pickBranch();
    await screen.findByText('شعر');
    openServicesTab();
    const row = (await screen.findByText('صبغة')).closest('tr')!;

    expect(within(row).getByText('150.00')).toBeDefined();
    expect(within(row).getByText('10.00%')).toBeDefined();
    expect(within(row).getByText('شعر')).toBeDefined();
  });

  test('shows an Arabic empty state when no service exists yet', async () => {
    mocks.listServices.mockResolvedValue(pageOf([]));
    renderView();
    await pickBranch();
    await screen.findByText('شعر');
    openServicesTab();

    expect(await screen.findByText('لا توجد خدمات بعد')).toBeDefined();
  });

  test('surfaces the Arabic error when services fail to load', async () => {
    mocks.listServices.mockRejectedValue(
      new ApiError(500, { code: 'UNEXPECTED_ERROR', message: 'حدث خطأ غير متوقع. حاول مرة أخرى.' }),
    );
    renderView();
    await pickBranch();
    await screen.findByText('شعر');
    openServicesTab();

    expect(await screen.findByText('تعذر تحميل الخدمات')).toBeDefined();
  });

  test('creates a service with the exact price the contract normalized', async () => {
    mocks.createService.mockResolvedValue({ ...colouring, id: 6 });
    renderView();
    await pickBranch();
    await screen.findByText('شعر');
    openServicesTab();
    fireEvent.click(await screen.findByRole('button', { name: 'إضافة خدمة' }));

    fireEvent.change(screen.getByLabelText(/^اسم الخدمة/), { target: { value: 'قص' } });
    fireEvent.change(screen.getByLabelText(/^التصنيف/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/^السعر/), { target: { value: '99.5' } });
    fireEvent.change(screen.getByLabelText(/^نسبة العمولة/), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الخدمة' }));

    await waitFor(() => expect(mocks.createService).toHaveBeenCalledTimes(1));
    expect(mocks.createService.mock.calls[0]?.[0]).toMatchObject({
      name: 'قص', categoryId: 1, price: '99.50', commissionPercent: '15.00', branchId: 3,
    });
  });

  test('blocks an invalid price in the browser without calling the API', async () => {
    renderView();
    await pickBranch();
    await screen.findByText('شعر');
    openServicesTab();
    fireEvent.click(await screen.findByRole('button', { name: 'إضافة خدمة' }));

    fireEvent.change(screen.getByLabelText(/^اسم الخدمة/), { target: { value: 'قص' } });
    fireEvent.change(screen.getByLabelText(/^التصنيف/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/^السعر/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الخدمة' }));

    expect(await screen.findByText('السعر يجب أن يكون أكبر من صفر')).toBeDefined();
    expect(mocks.createService).not.toHaveBeenCalled();
  });

  test('retires a service by deactivating it and offers no delete action', async () => {
    mocks.updateService.mockResolvedValue({ ...colouring, isActive: false });
    renderView();
    await pickBranch();
    await screen.findByText('شعر');
    openServicesTab();
    const row = (await screen.findByText('صبغة')).closest('tr')!;

    expect(within(row).queryByRole('button', { name: 'حذف' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'إيقاف' }));

    await waitFor(() => expect(mocks.updateService).toHaveBeenCalledTimes(1));
    expect(mocks.updateService.mock.calls[0]?.slice(0, 2))
      .toEqual([5, { isActive: false, branchId: 3 }]);
  });
});

describe('CatalogView employee commission overrides', () => {
  const openOverrides = async () => {
    renderView();
    await pickBranch();
    await screen.findByText('شعر');
    openServicesTab();
    const row = (await screen.findByText('صبغة')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'العمولات' }));
  };

  test('shows the service default when no employee override exists', async () => {
    await openOverrides();

    expect(await screen.findByText('لا توجد نسب خاصة؛ يطبَّق افتراضي الخدمة 10.00%')).toBeDefined();
  });

  test('sets a per-employee override', async () => {
    mocks.setCommissionOverride.mockResolvedValue({
      id: 1, serviceId: 5, employeeId: 7, commissionPercent: '25.00',
      createdAt: '2026-08-01T09:00:00.000Z', updatedAt: '2026-08-01T09:00:00.000Z',
    });
    await openOverrides();

    fireEvent.change(await screen.findByLabelText(/^الموظف/), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText(/^النسبة/), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ النسبة' }));

    await waitFor(() => expect(mocks.setCommissionOverride).toHaveBeenCalledTimes(1));
    expect(mocks.setCommissionOverride.mock.calls[0]?.slice(0, 2))
      .toEqual([5, { employeeId: 7, commissionPercent: '25.00', branchId: 3 }]);
  });

  test('lists an existing override with its employee name and removes it', async () => {
    mocks.listCommissionOverrides.mockResolvedValue([
      {
        id: 1, serviceId: 5, employeeId: 7, commissionPercent: '25.00',
        createdAt: '2026-08-01T09:00:00.000Z', updatedAt: '2026-08-01T09:00:00.000Z',
      },
    ]);
    mocks.removeCommissionOverride.mockResolvedValue(undefined);
    await openOverrides();

    // Scoped to the table: the same name also appears in the employee select.
    const row = (await screen.findByRole('cell', { name: 'سارة' })).closest('tr')!;
    expect(within(row).getByText('25.00%')).toBeDefined();

    fireEvent.click(within(row).getByRole('button', { name: 'إزالة' }));

    await waitFor(() => expect(mocks.removeCommissionOverride).toHaveBeenCalledWith(5, 7, 3));
  });

  test('surfaces the Arabic error when an override cannot be saved', async () => {
    mocks.setCommissionOverride.mockRejectedValue(new ApiError(404, {
      code: 'CATALOG_EMPLOYEE_NOT_FOUND',
      message: 'الموظف غير موجود في هذا الفرع',
    }));
    await openOverrides();

    fireEvent.change(await screen.findByLabelText(/^الموظف/), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText(/^النسبة/), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ النسبة' }));

    expect(await screen.findByText('الموظف غير موجود في هذا الفرع')).toBeDefined();
  });
});
