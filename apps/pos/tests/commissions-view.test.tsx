import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  branches: vi.fn(),
  createPayout: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: mocks.getSession,
}));

vi.mock('../src/features/commissions/api/commissions-api', () => ({
  listCommissions: mocks.list,
  getCommissionDetail: mocks.detail,
  createCommissionPayout: mocks.createPayout,
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
  paidAmount: '40.00',
  availableAmount: '210.00',
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
    reassignmentId: null,
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
    reassignmentId: null,
    occurredAt: '2026-09-01T09:00:00.000Z',
  }],
  payouts: [{
    id: 5,
    employeeId: 7,
    payrollMonth: '2026-08',
    branchId: 2,
    amount: '40.00',
    expenseId: 9,
    reason: 'دفعة جزئية',
    createdAt: '2026-08-15T10:00:00.000Z',
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
  mocks.getSession.mockResolvedValue({ actor: { type: 'admin' } });
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
  it('lets a cashier view and pay commissions from their own branch without selecting one', async () => {
    mocks.getSession.mockResolvedValue({ actor: { type: 'cashier', accountId: 8 } });
    mocks.createPayout.mockResolvedValue({
      payout: {
        id: 6, employeeId: 7, payrollMonth: '2026-08', branchId: 2, amount: '50.00',
        expenseId: 10, reason: null, createdAt: '2026-08-20T10:00:00.000Z',
      },
      summary: { ...summary, paidAmount: '90.00', availableAmount: '160.00' },
    });
    sessionStorage.setItem('capella:pos-admin-branch', '99');
    mount();

    expect(screen.queryByLabelText('الفرع')).toBeNull();
    const row = (await screen.findByText('سارة أحمد')).closest('tr')!;
    expect(mocks.branches).not.toHaveBeenCalled();
    expect(mocks.list.mock.calls[0]?.[0]).not.toHaveProperty('branchId');
    fireEvent.click(within(row).getByRole('button', { name: 'صرف عمولة' }));
    const dialog = await screen.findByRole('dialog', { name: /صرف عمولة/ });
    fireEvent.change(within(dialog).getByLabelText('المبلغ'), { target: { value: '50.00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد الصرف' }));

    await waitFor(() => expect(mocks.createPayout).toHaveBeenCalledWith(7, expect.any(String), {
      amount: '50.00',
    }));
  });
  it('fills both filter columns without extra inner space', async () => {
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    const branch = screen.getByLabelText('الفرع');
    const month = screen.getByRole('button', { name: 'شهر العمولة' });
    expect(branch.className).toContain('w-full');
    expect(branch.className).not.toContain('max-w-sm');
    expect(month.parentElement?.className).toContain('[&>button]:w-full');
  });

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

  it('shows paid and available totals and posts a mid-month payout', async () => {
    mocks.createPayout.mockResolvedValue({
      payout: {
        id: 6, employeeId: 7, payrollMonth: '2026-08', branchId: 2, amount: '50.00',
        expenseId: 10, reason: null, createdAt: '2026-08-20T10:00:00.000Z',
      },
      summary: { ...summary, paidAmount: '90.00', availableAmount: '160.00' },
    });
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    const row = (await screen.findByText('سارة أحمد')).closest('tr')!;

    expect(within(row).getByText(/40\.00/)).toBeDefined();
    expect(within(row).getByText(/210\.00/)).toBeDefined();

    fireEvent.click(within(row).getByRole('button', { name: 'صرف عمولة' }));
    const dialog = await screen.findByRole('dialog', { name: /صرف عمولة سارة أحمد/ });
    const amount = within(dialog).getByLabelText('المبلغ');
    fireEvent.change(amount, { target: { value: '50.00' } });
    fireEvent.change(within(dialog).getByLabelText('السبب (اختياري)'), {
      target: { value: 'دفعة جزئية' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد الصرف' }));

    await waitFor(() => expect(mocks.createPayout).toHaveBeenCalledWith(7, expect.any(String), {
      amount: '50.00', branchId: 2, reason: 'دفعة جزئية',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('returns to the list after canceling a row-started payout', async () => {
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    const row = (await screen.findByText('سارة أحمد')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'صرف عمولة' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'إلغاء' }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns to updated details after a details-started payout', async () => {
    mocks.createPayout.mockResolvedValue({
      payout: {
        id: 6, employeeId: 7, payrollMonth: '2026-08', branchId: 2, amount: '50.00',
        expenseId: 10, reason: null, createdAt: '2026-08-20T10:00:00.000Z',
      },
      summary: { ...summary, paidAmount: '90.00', availableAmount: '160.00' },
    });
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    const row = (await screen.findByText('سارة أحمد')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'التفاصيل' }));
    const details = await screen.findByRole('dialog');
    fireEvent.click(within(details).getByRole('button', { name: 'صرف عمولة' }));
    const payout = await screen.findByRole('dialog', { name: /صرف عمولة/ });
    fireEvent.change(within(payout).getByLabelText('المبلغ'), { target: { value: '50.00' } });
    fireEvent.click(within(payout).getByRole('button', { name: 'تأكيد الصرف' }));

    const updatedDetails = await screen.findByRole('dialog', { name: /تفاصيل عمولة/ });
    expect(within(updatedDetails).getByText(/160\.00/)).toBeDefined();
  });

  it('returns to details when a details-started payout is canceled', async () => {
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    const row = (await screen.findByText('سارة أحمد')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'التفاصيل' }));
    const details = await screen.findByRole('dialog');
    fireEvent.click(within(details).getByRole('button', { name: 'صرف عمولة' }));
    const payout = await screen.findByRole('dialog', { name: /صرف عمولة/ });
    fireEvent.click(within(payout).getByRole('button', { name: 'إلغاء' }));

    expect(await screen.findByRole('dialog', { name: /تفاصيل عمولة/ })).toBeDefined();
  });

  it('blocks a non-positive payout amount before calling the API', async () => {
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });
    const row = (await screen.findByText('سارة أحمد')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'صرف عمولة' }));
    const dialog = await screen.findByRole('dialog', { name: /صرف عمولة سارة أحمد/ });
    fireEvent.change(within(dialog).getByLabelText('المبلغ'), { target: { value: '00.00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد الصرف' }));

    expect(screen.getByText('أدخل مبلغًا موجبًا بصيغة 0.00')).toBeDefined();
    expect(mocks.createPayout).not.toHaveBeenCalled();
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
