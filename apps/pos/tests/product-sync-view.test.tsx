import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BranchLink, SyncSetup } from '../src/features/product-sync/api/product-sync-api';

const mocks = vi.hoisted(() => ({
  branches: vi.fn(),
  links: vi.fn(),
  setup: vi.fn(),
  settle: vi.fn(),
  activate: vi.fn(),
  createLink: vi.fn(),
  removeLink: vi.fn(),
  excluded: vi.fn(),
}));

vi.mock('../src/features/catalog', () => ({ listCatalogBranches: mocks.branches }));
vi.mock('../src/features/product-sync/api/product-sync-api', () => ({
  listBranchLinks: mocks.links,
  getSyncSetup: mocks.setup,
  settleSyncRow: mocks.settle,
  activateBranchLink: mocks.activate,
  createBranchLink: mocks.createLink,
  deleteBranchLink: mocks.removeLink,
  listExcludedProducts: mocks.excluded,
}));

import { ProductSyncView } from '../src/features/product-sync';

const link: BranchLink = {
  id: 1, senderBranchId: 2, senderBranchName: 'الرئيسي',
  receiverBranchId: 3, receiverBranchName: 'الفرع الثاني',
  state: 'pending', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

const setupWith = (overrides: Partial<SyncSetup> = {}): SyncSetup => ({
  link,
  receiverProducts: [{ id: 10, name: 'شامبو', barcode: null }],
  allGreen: false,
  rows: [{
    senderProductId: 5, name: 'سيروم', description: null, barcode: null,
    state: 'conflict', kind: 'only_in_sender', receiverProductId: null, candidates: [],
  }],
  ...overrides,
});

const renderView = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <ProductSyncView />
  </QueryClientProvider>,
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProductSyncView', () => {
  it('offers only branches the link rules still allow', async () => {
    mocks.branches.mockResolvedValue({
      items: [{ id: 2, name: 'الرئيسي' }, { id: 3, name: 'الفرع الثاني' }, { id: 4, name: 'الثالث' }],
      meta: { page: 1, pageSize: 100, total: 3, totalPages: 1 },
    });
    mocks.links.mockResolvedValue([link]);
    mocks.excluded.mockResolvedValue([]);
    renderView();

    expect(await screen.findByText('الرئيسي ← الفرع الثاني')).toBeDefined();
    // The receiver is a receiver already, so it cannot send; the sender may.
    const sender = screen.getByLabelText('الفرع المرسل');
    expect(sender.querySelector('option[value="3"]')).toBeNull();
    expect(sender.querySelector('option[value="2"]')).not.toBeNull();

    fireEvent.change(sender, { target: { value: '2' } });
    const receiver = screen.getByLabelText('الفرع المستلم');
    // 2 already sends and 3 already receives; only the untouched branch is left.
    expect(receiver.querySelector('option[value="3"]')).toBeNull();
    expect(receiver.querySelector('option[value="4"]')).not.toBeNull();
  });

  it('keeps activation disabled until every row is green', async () => {
    mocks.branches.mockResolvedValue({ items: [{ id: 2, name: 'الرئيسي' }], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
    mocks.links.mockResolvedValue([link]);
    mocks.setup.mockResolvedValue(setupWith());
    mocks.excluded.mockResolvedValue([]);
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'إعداد' }));
    expect(await screen.findByText('سيروم')).toBeDefined();
    expect(screen.getByText('يحتاج قرارًا')).toBeDefined();
    expect((screen.getByRole('button', { name: 'تفعيل الرابط' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('settles a row as "don\'t copy" from the conflict controls', async () => {
    mocks.branches.mockResolvedValue({ items: [{ id: 2, name: 'الرئيسي' }], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
    mocks.links.mockResolvedValue([link]);
    mocks.setup.mockResolvedValue(setupWith());
    mocks.excluded.mockResolvedValue([]);
    mocks.settle.mockResolvedValue(setupWith({ allGreen: true }));
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'إعداد' }));
    await screen.findByText('سيروم');
    fireEvent.click(screen.getByRole('button', { name: 'عدم النسخ' }));

    await waitFor(() => expect(mocks.settle).toHaveBeenCalledWith(1, 5, { action: 'exclude', notSameAsProductId: null }));
    // The refreshed setup now unlocks activation.
    await waitFor(() => expect((screen.getByRole('button', { name: 'تفعيل الرابط' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('activates the link once the setup is complete', async () => {
    mocks.branches.mockResolvedValue({ items: [{ id: 2, name: 'الرئيسي' }], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
    mocks.links.mockResolvedValue([{ ...link, state: 'pending' }]);
    mocks.setup.mockResolvedValue(setupWith({
      allGreen: true,
      rows: [{
        senderProductId: 5, name: 'سيروم', description: null, barcode: null,
        state: 'green', kind: 'auto', receiverProductId: 10, candidates: [],
      }],
    }));
    mocks.excluded.mockResolvedValue([]);
    mocks.activate.mockResolvedValue(setupWith({ allGreen: true, link: { ...link, state: 'active' } }));
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'إعداد' }));
    const activate = await screen.findByRole('button', { name: 'تفعيل الرابط' });
    expect((activate as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(activate);

    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith(1));
  });
});
