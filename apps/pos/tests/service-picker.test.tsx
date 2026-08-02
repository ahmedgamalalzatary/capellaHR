import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({ listServices: vi.fn() }));

vi.mock('../src/features/catalog/api/catalog-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listServices: mocks.listServices,
}));

import { ServicePicker } from '../src/features/catalog';

const colouring = {
  id: 5,
  branchId: 3,
  categoryId: 1,
  name: 'صبغة',
  description: 'صبغة كاملة',
  price: '150.00',
  commissionPercent: '10.00',
  isActive: true,
  categoryName: 'شعر',
  categoryIsActive: true,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

const pageOf = (items: unknown[]) => ({
  items,
  meta: { page: 1, pageSize: 50, total: items.length, totalPages: 1 },
});

function renderPicker(onSelect?: (service: unknown) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServicePicker {...(onSelect ? { onSelect } : {})} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.listServices.mockResolvedValue(pageOf([colouring]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ServicePicker', () => {
  test('browses only the sellable services of the acting branch', async () => {
    renderPicker();

    await waitFor(() => expect(mocks.listServices).toHaveBeenCalled());
    // Retired services and services of a retired category are never offered.
    expect(mocks.listServices.mock.calls[0]?.[0]).toMatchObject({ isActive: true });
    expect(mocks.listServices.mock.calls[0]?.[0]?.branchId).toBeUndefined();
  });

  test('shows the fixed price, which the cashier can never edit', async () => {
    renderPicker();
    await screen.findByText('صبغة');

    expect(screen.getByText('150.00 ج.م')).toBeDefined();
    expect(screen.queryByLabelText(/السعر/)).toBeNull();
  });

  test('shows an Arabic loading state before results arrive', () => {
    renderPicker();

    expect(screen.getByText('جارٍ تحميل الخدمات…')).toBeDefined();
  });

  test('passes the search term to the API', async () => {
    renderPicker();
    await screen.findByText('صبغة');
    fireEvent.change(screen.getByLabelText('بحث عن خدمة'), { target: { value: 'صبغ' } });

    await waitFor(() => {
      expect(mocks.listServices.mock.calls.at(-1)?.[0]).toMatchObject({ search: 'صبغ' });
    });
  });

  test('omits the search filter when the typed term is only whitespace', async () => {
    renderPicker();
    await screen.findByText('صبغة');
    fireEvent.change(screen.getByLabelText('بحث عن خدمة'), { target: { value: '   ' } });

    await waitFor(() => {
      expect(mocks.listServices.mock.calls.at(-1)?.[0]?.search).toBeUndefined();
    });
  });

  test('distinguishes an empty search result from an empty catalog', async () => {
    mocks.listServices.mockResolvedValue(pageOf([]));
    renderPicker();

    expect(await screen.findByText('لا توجد خدمات متاحة')).toBeDefined();

    fireEvent.change(screen.getByLabelText('بحث عن خدمة'), { target: { value: 'قص' } });
    expect(await screen.findByText('لا توجد خدمة مطابقة')).toBeDefined();
  });

  test('surfaces the Arabic error with a retry action', async () => {
    mocks.listServices.mockRejectedValue(
      new ApiError(500, { code: 'UNEXPECTED_ERROR', message: 'حدث خطأ غير متوقع. حاول مرة أخرى.' }),
    );
    renderPicker();

    expect(await screen.findByText('تعذر تحميل الخدمات')).toBeDefined();

    mocks.listServices.mockResolvedValue(pageOf([colouring]));
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));

    expect(await screen.findByText('صبغة')).toBeDefined();
  });

  test('hands the chosen service back with its exact price', async () => {
    const onSelect = vi.fn();
    renderPicker(onSelect);
    fireEvent.click(await screen.findByRole('button', { name: /صبغة/ }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 5, price: '150.00' }));
  });

  test('renders a read-only list when no selection handler is given', async () => {
    renderPicker();
    await screen.findByText('صبغة');

    expect(screen.queryByRole('button', { name: /صبغة/ })).toBeNull();
  });
});
