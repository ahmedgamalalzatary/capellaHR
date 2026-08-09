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
  it('shows monthly employee totals and invoice-line reversal traceability', async () => {
    mount();
    await screen.findByRole('option', { name: 'الرئيسي' });
    fireEvent.change(screen.getByLabelText('الفرع'), { target: { value: '2' } });

    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({
      branchId: 2,
      month: '2026-08',
      page: 1,
    })));
    const row = (await screen.findByText('سارة أحمد')).closest('tr')!;
    expect(within(row).getByText(/250\.00/)).toBeDefined();
    expect(within(row).getByText(/300\.00/)).toBeDefined();
    expect(within(row).getByText(/^50\.00/)).toBeDefined();

    fireEvent.click(within(row).getByRole('button', { name: 'التفاصيل' }));

    await waitFor(() => expect(mocks.detail).toHaveBeenCalledWith(7, '2026-08', 2));
    expect(await screen.findAllByText('INV-2026.08.03-14.35-17')).toHaveLength(2);
    expect(screen.getAllByText('صبغة شعر')).toHaveLength(2);
    expect(screen.getAllByText('بند #1')).toHaveLength(2);
    expect(document.querySelector('time[datetime="2026-09-01T09:00:00.000Z"]')).not.toBeNull();
    expect(screen.getByText('عكس عمولة')).toBeDefined();
    expect(screen.getByText('#41')).toBeDefined();
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
