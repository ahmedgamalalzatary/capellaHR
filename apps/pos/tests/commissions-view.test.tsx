import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  branches: vi.fn(),
}));

vi.mock('../src/features/commissions/api/commissions-api', () => ({
  listCommissions: mocks.list,
  getCommissionDetail: mocks.detail,
}));
vi.mock('../src/features/cashier-sessions', () => ({
  listCashierSessionBranches: mocks.branches,
}));

import { CommissionsView } from '../src/features/commissions/components/commissions-view';

const summary = {
  employeeId: 7,
  employeeCode: 1007,
  employeeName: 'سارة أحمد',
  payrollMonth: '2026-08',
  earnedAmount: '300.00',
  reversedAmount: '50.00',
  netAmount: '250.00',
  invoiceLineCount: 3,
  reversalCount: 1,
};
const detail = {
  summary,
  entries: [{
    id: 11,
    type: 'earned' as const,
    invoiceId: 21,
    invoiceNumber: 'INV-2026.08.03-14.35-17',
    invoiceLineId: 31,
    lineNumber: 1,
    serviceName: 'صبغة شعر',
    baseAmount: '100.00',
    commissionRate: '10.00',
    amount: '10.00',
    reversalId: null,
    occurredAt: '2026-08-03T12:35:00.000Z',
  }, {
    id: 12,
    type: 'reversal' as const,
    invoiceId: 21,
    invoiceNumber: 'INV-2026.08.03-14.35-17',
    invoiceLineId: 31,
    lineNumber: 1,
    serviceName: 'صبغة شعر',
    baseAmount: '100.00',
    commissionRate: '10.00',
    amount: '-10.00',
    reversalId: 41,
    occurredAt: '2026-09-01T09:00:00.000Z',
  }],
};

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CommissionsView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  mocks.branches.mockResolvedValue({
    items: [{ id: 2, name: 'الرئيسي' }],
    meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
  });
  mocks.list.mockResolvedValue({
    items: [summary],
    meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  });
  mocks.detail.mockResolvedValue(detail);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CommissionsView', () => {
  it('announces loading monthly totals', async () => {
    mocks.list.mockReturnValue(new Promise(() => undefined));
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });

    expect(screen.getByRole('status', { name: 'جارٍ تحميل العمولات…' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: 'العمولات' })).toBeDefined();
  });

  it('does not load commissions until a month is selected', async () => {
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.click(screen.getByRole('button', { name: 'شهر العمولة' }));
    fireEvent.click(screen.getByRole('button', { name: 'مسح الشهر' }));
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });

    expect(screen.getByText('اختر شهرًا لعرض العمولات')).toBeDefined();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('offers a twelve-month calendar grid instead of a text field', async () => {
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    expect(document.querySelector('input[type="month"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'شهر العمولة' }));
    for (const name of ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']) {
      expect(screen.getByRole('button', { name })).toBeDefined();
    }
  });

  it('shows monthly employee totals and invoice-line reversal traceability', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'شهر العمولة' }));
    const year = within(screen.getByRole('dialog')).getByText(/^\d{4}$/).textContent!;
    fireEvent.click(screen.getByRole('button', { name: 'أغسطس' }));
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });

    const targetMonth = `${year}-08`;
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({
      branchId: 2,
      month: targetMonth,
      page: 1,
    })));
    const row = (await screen.findByText('سارة أحمد')).closest('tr')!;
    expect(within(row).getByText(/250\.00/)).toBeDefined();
    expect(within(row).getByText(/300\.00/)).toBeDefined();
    expect(within(row).getByText(/^50\.00/)).toBeDefined();

    fireEvent.click(within(row).getByRole('button', { name: 'التفاصيل' }));

    await waitFor(() => expect(mocks.detail).toHaveBeenCalledWith(7, targetMonth, 2));
    expect(await screen.findAllByText('INV-2026.08.03-14.35-17')).toHaveLength(2);
    expect(screen.getAllByText('صبغة شعر')).toHaveLength(2);
    expect(screen.getAllByText('بند #1')).toHaveLength(2);
    expect(document.querySelector('time[datetime="2026-09-01T09:00:00.000Z"]')).not.toBeNull();
    expect(screen.getByText('عكس عمولة')).toBeDefined();
    expect(screen.getByText('#41')).toBeDefined();
  });

  it('uses the available viewport width and scrolls long commission details', async () => {
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    const row = (await screen.findByText('سارة أحمد')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'التفاصيل' }));

    const dialog = await screen.findByRole('dialog', { name: /تفاصيل عمولة سارة أحمد/ });
    expect(dialog.className).toContain('max-w-6xl');
    const table = await within(dialog).findByRole('table');
    expect(table.parentElement?.className).toContain('overflow-y-auto');
  });

  it('loads every branch page and offers retry when totals fail', async () => {
    mocks.branches.mockImplementation(async (page = 1) => ({
      items: page === 1 ? [{ id: 2, name: 'الرئيسي' }] : [{ id: 3, name: 'فرع ثانٍ' }],
      meta: { page, pageSize: 100, total: 2, totalPages: 2 },
    }));
    mocks.list.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({
      items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    mount();

    await screen.findByRole('option', { name: 'فرع ثانٍ' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('لا توجد عمولات لهذا الشهر')).toBeDefined();
  });
});
