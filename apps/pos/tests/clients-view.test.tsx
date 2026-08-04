import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  actor: { current: { type: 'cashier', accountId: 3, employeeId: 9 } as
    { type: 'cashier'; accountId: number; employeeId: number } | { type: 'admin'; accountId: number } },
  listClients: vi.fn(),
  listClientBranches: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  findClientByPhone: vi.fn(),
}));

vi.mock('../src/features/auth', () => ({
  useSession: () => ({ isSuccess: true, data: { actor: mocks.actor.current } }),
}));

vi.mock('../src/features/clients/api/clients-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listClients: mocks.listClients,
  listClientBranches: mocks.listClientBranches,
  createClient: mocks.createClient,
  updateClient: mocks.updateClient,
  findClientByPhone: mocks.findClientByPhone,
}));

import { ClientsView } from '../src/features/clients/components/clients-view';

const nada = {
  id: 1,
  branchId: 3,
  fullName: 'ندى سمير',
  phone: '01001234567',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

const pageOf = (items: unknown[], meta: Partial<Record<string, number>> = {}) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...meta },
});

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientsView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.actor.current = { type: 'cashier', accountId: 3, employeeId: 9 };
  mocks.listClients.mockResolvedValue(pageOf([nada]));
  mocks.listClientBranches.mockResolvedValue(pageOf([{ id: 3, name: 'Main' }]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ClientsView', () => {
  test('scopes Admin listing and creation to the selected branch', async () => {
    mocks.actor.current = { type: 'admin', accountId: 1 };
    mocks.createClient.mockResolvedValue({ ...nada, id: 2 });
    renderView();

    await screen.findByRole('option', { name: 'Main' });
    expect(mocks.listClients).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '3' } });
    await waitFor(() => expect(mocks.listClients).toHaveBeenCalledWith(expect.objectContaining({ branchId: 3 })));

    fireEvent.click(screen.getByRole('button', { name: 'إضافة عميل' }));
    fireEvent.change(screen.getByLabelText(/^اسم العميل/), { target: { value: 'مريم' } });
    fireEvent.change(screen.getByLabelText(/^رقم الهاتف/), { target: { value: '01112223344' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة العميل' }));
    await waitFor(() => expect(mocks.createClient).toHaveBeenCalledWith(expect.objectContaining({ branchId: 3 })));
  });

  test('shows and retries an Admin branch-loading error', async () => {
    mocks.actor.current = { type: 'admin', accountId: 1 };
    mocks.listClientBranches.mockRejectedValueOnce(
      new ApiError(500, { code: 'UNEXPECTED_ERROR', message: 'تعذر تحميل الفروع' }),
    ).mockResolvedValueOnce(pageOf([{ id: 3, name: 'Main' }]));
    renderView();

    expect(await screen.findAllByText('تعذر تحميل الفروع')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));

    expect(await screen.findByRole('option', { name: 'Main' })).toBeDefined();
    expect(mocks.listClientBranches).toHaveBeenCalledTimes(2);
  });

  test('lists clients with their name and phone', async () => {
    renderView();
    const row = (await screen.findByText('ندى سمير')).closest('tr')!;

    expect(within(row).getByText('01001234567')).toBeDefined();
  });

  test('shows an Arabic empty state when no client exists yet', async () => {
    mocks.listClients.mockResolvedValue(pageOf([]));
    renderView();

    expect(await screen.findByText('لا يوجد عملاء بعد')).toBeDefined();
  });

  test('distinguishes an empty search result from an empty database', async () => {
    mocks.listClients.mockResolvedValue(pageOf([]));
    renderView();
    fireEvent.change(screen.getByLabelText('بحث بالاسم أو رقم الهاتف'), { target: { value: '0100' } });

    expect(await screen.findByText('لا يوجد عميل مطابق')).toBeDefined();
  });

  test('passes the search term to the API', async () => {
    renderView();
    await screen.findByText('ندى سمير');
    fireEvent.change(screen.getByLabelText('بحث بالاسم أو رقم الهاتف'), { target: { value: 'ندى' } });

    await waitFor(() => {
      expect(mocks.listClients.mock.calls.at(-1)?.[0]).toMatchObject({ search: 'ندى', page: 1 });
    });
  });

  test('omits the search filter when the typed term is only whitespace', async () => {
    renderView();
    await screen.findByText('ندى سمير');
    fireEvent.change(screen.getByLabelText('بحث بالاسم أو رقم الهاتف'), { target: { value: '   ' } });

    await waitFor(() => {
      expect(mocks.listClients.mock.calls.at(-1)?.[0]).toEqual({ page: 1 });
    });
  });

  test('treats a whitespace-only search as no search in the empty state', async () => {
    mocks.listClients.mockResolvedValue(pageOf([]));
    renderView();
    fireEvent.change(screen.getByLabelText('بحث بالاسم أو رقم الهاتف'), { target: { value: '   ' } });

    expect(await screen.findByText('لا يوجد عملاء بعد')).toBeDefined();
  });

  test('trims the search term before sending it to the API', async () => {
    renderView();
    await screen.findByText('ندى سمير');
    fireEvent.change(screen.getByLabelText('بحث بالاسم أو رقم الهاتف'), { target: { value: '  ندى  ' } });

    await waitFor(() => {
      expect(mocks.listClients.mock.calls.at(-1)?.[0]).toMatchObject({ search: 'ندى', page: 1 });
    });
  });

  test('surfaces the Arabic error when the list fails to load', async () => {
    mocks.listClients.mockRejectedValue(
      new ApiError(500, { code: 'UNEXPECTED_ERROR', message: 'حدث خطأ غير متوقع. حاول مرة أخرى.' }),
    );
    renderView();

    expect(await screen.findByText('تعذر تحميل العملاء')).toBeDefined();
  });

  test('creates a client with the normalized phone', async () => {
    mocks.createClient.mockResolvedValue({ ...nada, id: 2 });
    renderView();
    await screen.findByText('ندى سمير');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة عميل' }));

    fireEvent.change(screen.getByLabelText(/^اسم العميل/), { target: { value: 'مريم' } });
    fireEvent.change(screen.getByLabelText(/^رقم الهاتف/), { target: { value: '+20 111 222 3344' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة العميل' }));

    await waitFor(() => expect(mocks.createClient).toHaveBeenCalledTimes(1));
    expect(mocks.createClient.mock.calls[0]?.[0]).toEqual({ fullName: 'مريم', phone: '01112223344' });
  });

  test('shows the Arabic validation message for a bad phone without calling the API', async () => {
    renderView();
    await screen.findByText('ندى سمير');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة عميل' }));

    fireEvent.change(screen.getByLabelText(/^اسم العميل/), { target: { value: 'مريم' } });
    fireEvent.change(screen.getByLabelText(/^رقم الهاتف/), { target: { value: '01301234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة العميل' }));

    expect(await screen.findByText('رقم الهاتف المصري غير صالح')).toBeDefined();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  test('surfaces the duplicate-phone conflict from the server', async () => {
    mocks.createClient.mockRejectedValue(
      new ApiError(409, { code: 'CLIENT_PHONE_EXISTS', message: 'رقم الهاتف مسجل لعميل آخر' }),
    );
    renderView();
    await screen.findByText('ندى سمير');
    fireEvent.click(screen.getByRole('button', { name: 'إضافة عميل' }));

    fireEvent.change(screen.getByLabelText(/^اسم العميل/), { target: { value: 'مريم' } });
    fireEvent.change(screen.getByLabelText(/^رقم الهاتف/), { target: { value: '01001234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة العميل' }));

    expect(await screen.findByText('رقم الهاتف مسجل لعميل آخر')).toBeDefined();
  });

  test('edits an existing client through the update endpoint', async () => {
    mocks.updateClient.mockResolvedValue({ ...nada, fullName: 'ندى سمير علي' });
    renderView();
    const row = (await screen.findByText('ندى سمير')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'تعديل' }));

    fireEvent.change(screen.getByLabelText(/^اسم العميل/), { target: { value: 'ندى سمير علي' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }));

    await waitFor(() => expect(mocks.updateClient).toHaveBeenCalledTimes(1));
    expect(mocks.updateClient.mock.calls[0]?.[0]).toBe(1);
  });

  test('paginates with the next button', async () => {
    mocks.listClients.mockResolvedValue(pageOf([nada], { total: 30, totalPages: 2 }));
    renderView();
    await screen.findByText('ندى سمير');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));

    await waitFor(() => {
      expect(mocks.listClients.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2 });
    });
  });
});
