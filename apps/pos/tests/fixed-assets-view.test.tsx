import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  branches: vi.fn(async () => ({ items: [{ id: 2, name: 'الرئيسي' }], meta: { totalPages: 1 } })),
}));
vi.mock('../src/features/auth', () => ({
  useSession: () => ({ data: { actor: { type: 'admin', accountId: 1 } } }),
}));
vi.mock('../src/features/catalog', () => ({ listCatalogBranches: mocks.branches }));
vi.mock('../src/features/fixed-assets/api/fixed-assets-api', () => ({
  listFixedAssets: mocks.list,
  createFixedAsset: mocks.create,
  updateFixedAsset: mocks.update,
  deleteFixedAsset: mocks.remove,
}));

import { FixedAssetsView } from '../src/features/fixed-assets';

const asset = {
  id: 10, branchId: 2, name: 'كرسي انتظار', quantity: 10, unitPrice: '350.00',
  location: 'الاستقبال', note: 'جلد بيج', purchasedOn: '2026-03-01', condition: 'good' as const,
  actingAccountId: 1, actingUsername: 'admin',
  createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-01T10:00:00Z',
};
const page = (items: unknown[]) => ({ items, meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1 } });

afterEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear(); });

const mount = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><FixedAssetsView /></QueryClientProvider>);
  return queryClient;
};
const chooseBranch = async () => {
  // The option must exist before jsdom will accept the value; the branches load first.
  await screen.findByRole('option', { name: 'الرئيسي' });
  fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
};

describe('FixedAssetsView', () => {
  it('asks for a branch before showing any register', async () => {
    mocks.list.mockResolvedValue(page([]));
    mount();

    expect(await screen.findByText('اختر فرعًا لعرض أصوله الثابتة')).toBeDefined();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('lists a branch register with the total value worked out for each line', async () => {
    mocks.list.mockResolvedValue(page([asset]));
    mount();
    await chooseBranch();

    expect(await screen.findByText('كرسي انتظار')).toBeDefined();
    // 10 × 350.00, computed for display so it can never disagree with the two numbers.
    expect(screen.getByText('3500.00 ج.م')).toBeDefined();
  });

  it('leaves the total blank when a price or a count was never written down', async () => {
    mocks.list.mockResolvedValue(page([{ ...asset, unitPrice: null }]));
    mount();
    await chooseBranch();

    await screen.findByText('كرسي انتظار');
    expect(screen.queryByText('3500.00 ج.م')).toBeNull();
  });

  it('writes a line carrying nothing but a name, because every other detail is optional', async () => {
    mocks.list.mockResolvedValue(page([]));
    mocks.create.mockResolvedValue(asset);
    mount();
    await chooseBranch();

    fireEvent.change(await screen.findByLabelText('اسم الأصل'), { target: { value: '  مرآة  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة' }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ branchId: 2, name: 'مرآة' }));
  });

  it('refuses to submit a line with no name at all', async () => {
    mocks.list.mockResolvedValue(page([]));
    mount();
    await chooseBranch();

    expect((await screen.findByRole('button', { name: 'إضافة' })).hasAttribute('disabled')).toBe(true);
  });

  it('edits a line in place, sending only what the admin left in the form', async () => {
    mocks.list.mockResolvedValue(page([asset]));
    mocks.update.mockResolvedValue({ ...asset, quantity: 8 });
    mount();
    await chooseBranch();

    fireEvent.click(await screen.findByRole('button', { name: 'تعديل' }));
    fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(10, expect.objectContaining({
      branchId: 2, name: 'كرسي انتظار', quantity: 8,
    })));
  });

  it('asks before deleting a line, since the delete is final', async () => {
    mocks.list.mockResolvedValue(page([asset]));
    mocks.remove.mockResolvedValue(undefined);
    mount();
    await chooseBranch();

    fireEvent.click(await screen.findByRole('button', { name: 'حذف' }));
    expect(mocks.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الحذف' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(10, 2));
  });

  it('searches the register by whatever the admin wrote', async () => {
    mocks.list.mockResolvedValue(page([asset]));
    mount();
    await chooseBranch();

    await screen.findByText('كرسي انتظار');
    fireEvent.change(screen.getByLabelText('بحث'), { target: { value: '  كرسي  ' } });

    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'كرسي' })));
  });
});
