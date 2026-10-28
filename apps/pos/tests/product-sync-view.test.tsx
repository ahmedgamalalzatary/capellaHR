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
  issues: vi.fn(),
  settleIssue: vi.fn(),
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
  listSyncIssues: mocks.issues,
  settleSyncIssue: mocks.settleIssue,
}));
mocks.issues.mockResolvedValue([]);

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
    expect((screen.getByRole('button', { name: 'تأكيد الإعداد وتفعيل الرابط' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows only unresolved conflicts in the setup popup', async () => {
    mocks.branches.mockResolvedValue({ items: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } });
    mocks.links.mockResolvedValue([link]);
    const conflict = setupWith().rows[0]!;
    mocks.setup.mockResolvedValue(setupWith({ rows: [
      conflict,
      { ...conflict, senderProductId: 6, name: 'مطابق تلقائيًا', state: 'green', kind: 'auto', receiverProductId: 10 },
      { ...conflict, senderProductId: 7, name: 'منتج مربوط', state: 'green', kind: 'linked', receiverProductId: 11 },
      { ...conflict, senderProductId: 8, name: 'منتج مستبعد', state: 'green', kind: 'excluded' },
    ] }));
    mocks.excluded.mockResolvedValue([{ senderProductId: 8, name: 'منتج مستبعد', notSameAs: null }]);
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'إعداد' }));
    expect(await screen.findByText('سيروم')).toBeDefined();
    expect(screen.queryByText('مطابق تلقائيًا')).toBeNull();
    expect(screen.queryByText('منتج مربوط')).toBeNull();
    expect(screen.queryByText('منتج مستبعد')).toBeNull();
    expect(screen.queryByText('مستبعدة من المزامنة')).toBeNull();
    expect((screen.getByRole('button', { name: 'تأكيد الإعداد وتفعيل الرابط' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps a decision editable as a draft until final confirmation', async () => {
    mocks.branches.mockResolvedValue({ items: [{ id: 2, name: 'الرئيسي' }], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
    mocks.links.mockResolvedValue([link]);
    mocks.setup.mockResolvedValue(setupWith());
    mocks.excluded.mockResolvedValue([]);
    mocks.settle.mockResolvedValue(setupWith({ allGreen: true, rows: [
      { ...setupWith().rows[0]!, state: 'green', kind: 'excluded' },
    ] }));
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'إعداد' }));
    await screen.findByText('سيروم');
    fireEvent.click(screen.getByRole('button', { name: 'عدم النسخ' }));

    expect(mocks.settle).not.toHaveBeenCalled();
    expect(screen.getByText('سيروم')).toBeDefined();
    expect(screen.getByText('قرار مؤقت: عدم النسخ')).toBeDefined();
    const confirm = screen.getByRole('button', { name: 'تأكيد الإعداد وتفعيل الرابط' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'تراجع عن قرار سيروم' }));
    expect(confirm.disabled).toBe(true);
    expect(screen.queryByText('قرار مؤقت: عدم النسخ')).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: 'المنتج المقابل لـ سيروم' }));
    fireEvent.click(screen.getByRole('option', { name: 'شامبو' }));
    fireEvent.click(screen.getByRole('button', { name: 'ربط بالمنتج' }));
    expect(screen.getByText('قرار مؤقت: ربط بـ «شامبو»')).toBeDefined();
    mocks.activate.mockResolvedValue(setupWith({ allGreen: true, link: { ...link, state: 'active' }, rows: [] }));
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith(1, {
      decisions: [{ senderProductId: 5, decision: { action: 'link', receiverProductId: 10 } }],
    }));
  });

  it('discards an unconfirmed create choice when setup closes', async () => {
    mocks.branches.mockResolvedValue({ items: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } });
    mocks.links.mockResolvedValue([link]);
    mocks.setup.mockResolvedValue(setupWith());
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'إعداد' }));
    await screen.findByText('سيروم');
    fireEvent.click(screen.getByRole('button', { name: 'نسخ باسم جديد' }));
    expect(screen.getByText('قرار مؤقت: إنشاء «سيروم»')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
    fireEvent.click(screen.getByRole('button', { name: 'إعداد' }));
    await screen.findByText('سيروم');
    expect(screen.queryByText('قرار مؤقت: إنشاء «سيروم»')).toBeNull();
    expect((screen.getByRole('button', { name: 'تأكيد الإعداد وتفعيل الرابط' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it('searches receiver products by name or barcode before choosing a draft link', async () => {
    mocks.branches.mockResolvedValue({ items: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } });
    mocks.links.mockResolvedValue([link]);
    mocks.setup.mockResolvedValue(setupWith({ receiverProducts: [
      { id: 10, name: 'Acne serum', barcode: 'SERUM123' },
      { id: 11, name: 'Almond oil', barcode: 'OIL456' },
    ] }));
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'إعداد' }));
    const picker = await screen.findByRole('combobox', { name: 'المنتج المقابل لـ سيروم' });
    fireEvent.click(picker);
    const search = screen.getByRole('searchbox', { name: 'بحث عن المنتج المقابل لـ سيروم' });
    fireEvent.change(search, { target: { value: 'serum' } });
    expect(screen.getByRole('option', { name: 'Acne serum' })).toBeDefined();
    expect(screen.queryByRole('option', { name: 'Almond oil' })).toBeNull();
    fireEvent.change(search, { target: { value: 'OIL456' } });
    fireEvent.click(screen.getByRole('option', { name: 'Almond oil' }));
    expect(picker.textContent).toContain('Almond oil');
    fireEvent.click(screen.getByRole('button', { name: 'ربط بالمنتج' }));
    expect(screen.getByText('قرار مؤقت: ربط بـ «Almond oil»')).toBeDefined();
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole('option', { name: 'بدون منتج مقابل' }));
    expect((screen.getByRole('button', { name: 'ربط بالمنتج' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows products that need attention and settles one', async () => {
    mocks.branches.mockResolvedValue({ items: [{ id: 2, name: 'الرئيسي' }], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
    mocks.links.mockResolvedValue([]);
    mocks.setup.mockResolvedValue(setupWith());
    mocks.issues.mockResolvedValue([{
      id: 7, linkId: 1, senderBranchId: 2, senderBranchName: 'الرئيسي',
      receiverBranchId: 3, receiverBranchName: 'الفرع الثاني',
      senderProductId: 5, productName: 'مرطب', reason: 'name_clash',
      createdAt: '2026-10-02T00:00:00Z',
    }]);
    mocks.settleIssue.mockResolvedValue([]);
    renderView();

    expect(await screen.findByText('مرطب')).toBeDefined();
    expect(screen.getByText('منتجات تحتاج انتباهًا')).toBeDefined();
    expect(screen.getByText('الاسم مستخدم في الفرع المستلم')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'عدم النسخ' }));
    await waitFor(() => expect(mocks.settleIssue)
      .toHaveBeenCalledWith(7, { action: 'exclude', notSameAsProductId: null }));
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
    const activate = await screen.findByRole('button', { name: 'تأكيد الإعداد وتفعيل الرابط' });
    expect(screen.queryByText('سيروم')).toBeNull();
    expect(screen.getByText('لا توجد تعارضات في الإعداد.')).toBeDefined();
    expect((activate as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(activate);

    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith(1, { decisions: [] }));
  });
});
