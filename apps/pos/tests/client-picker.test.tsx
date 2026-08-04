import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listClients: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  findClientByPhone: vi.fn(),
}));

vi.mock('../src/features/clients/api/clients-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listClients: mocks.listClients,
  createClient: mocks.createClient,
  updateClient: mocks.updateClient,
  findClientByPhone: mocks.findClientByPhone,
}));

import { ClientPicker } from '../src/features/clients/components/client-picker';

const nada = {
  id: 1,
  branchId: 3,
  fullName: 'ندى سمير',
  phone: '01001234567',
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

const pageOf = (items: unknown[]) => ({
  items,
  meta: { page: 1, pageSize: 10, total: items.length, totalPages: 1 },
});

function renderPicker(onSelect = vi.fn(), selected: typeof nada | null = null, branchId?: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ClientPicker selected={selected} onSelect={onSelect} {...(branchId === undefined ? {} : { branchId })} />
    </QueryClientProvider>,
  );
  return onSelect;
}

const search = (value: string) =>
  fireEvent.change(screen.getByLabelText('ابحث عن العميل برقم الهاتف أو الاسم'), { target: { value } });

beforeEach(() => {
  mocks.listClients.mockResolvedValue(pageOf([nada]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ClientPicker', () => {
  test('does not search until enough characters are typed', async () => {
    renderPicker();
    search('01');

    expect(screen.getByText('اكتب 3 أرقام أو حروف على الأقل للبحث.')).toBeDefined();
    await waitFor(() => expect(mocks.listClients).not.toHaveBeenCalled());
  });

  test('selects a matching client', async () => {
    const onSelect = renderPicker(vi.fn(), null, 3);
    search('0100');

    fireEvent.click(await screen.findByText('ندى سمير'));

    expect(onSelect).toHaveBeenCalledWith(nada);
    expect(mocks.listClients.mock.calls[0]?.[0]).toMatchObject({ branchId: 3 });
  });

  test('states that a sale cannot proceed without a client when none matches', async () => {
    mocks.listClients.mockResolvedValue(pageOf([]));
    renderPicker();
    search('0100');

    expect(await screen.findByText('لا يوجد عميل بهذا الرقم')).toBeDefined();
    expect(screen.getByText('لا يمكن إتمام بيع بدون عميل، أضف العميل الآن.')).toBeDefined();
  });

  test('creates a client inline, pre-filling the typed number, and selects it', async () => {
    mocks.listClients.mockResolvedValue(pageOf([]));
    mocks.createClient.mockResolvedValue({ ...nada, id: 5, fullName: 'مريم' });
    const onSelect = renderPicker(vi.fn(), null, 3);
    search('01112223344');

    fireEvent.click(await screen.findByRole('button', { name: 'إضافة عميل جديد' }));

    // The number the cashier already typed carries into the form.
    expect((screen.getByLabelText(/^رقم الهاتف/) as HTMLInputElement).value).toBe('01112223344');

    fireEvent.change(screen.getByLabelText(/^اسم العميل/), { target: { value: 'مريم' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة العميل' }));

    await waitFor(() => expect(mocks.createClient).toHaveBeenCalledTimes(1));
    expect(mocks.createClient.mock.calls[0]?.[0]).toMatchObject({ branchId: 3 });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 5 })));
  });

  test('shows the chosen client and clears it when changing', () => {
    const onSelect = renderPicker(vi.fn(), nada);

    expect(screen.getByText('ندى سمير')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'تغيير العميل' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
