import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({ getCashierSessionDetail: vi.fn() }));

vi.mock('../src/features/cashier-sessions/api/cashier-sessions-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCashierSessionDetail: mocks.getCashierSessionDetail,
}));

import { ShiftDetailView } from '../src/features/cashier-sessions';

const detail = {
  summary: {
    id: 14,
    branchId: 3,
    branchName: 'الفرع الرئيسي',
    openedByAccountId: 8,
    openedByUsername: 'cashier.one',
    openedAt: '2026-08-01T09:30:00.000Z',
    closedAt: '2026-08-01T17:30:00.000Z',
    closedByAccountId: 8,
    closedByUsername: 'cashier.one',
    autoClosedAt: null,
    durationMinutes: 480,
    saleCount: 1,
    taken: { cash: '185.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
    refunded: { cash: '0.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
    takenTotal: '185.00',
    refundedTotal: '0.00',
    net: '185.00',
  },
  invoices: [{
    id: 41,
    invoiceNumber: 'INV-2026.08.01-12.00-3',
    status: 'completed' as const,
    client: { id: 5, name: 'عميل', phone: null },
    total: '185.00',
    takenInShift: '185.00',
    refundedInShift: '0.00',
    soldAt: '2026-08-01T12:00:00.000Z',
  }],
};

function renderView(sessionId = 14) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ShiftDetailView sessionId={sessionId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getCashierSessionDetail.mockReset();
  mocks.getCashierSessionDetail.mockResolvedValue(detail);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShiftDetailView', () => {
  test('shows the shift money and the sales behind it', async () => {
    renderView();

    expect((await screen.findAllByText('185.00 ج.م')).length).toBeGreaterThan(0);
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('INV-2026.08.01-12.00-3')).toBeDefined();
    expect(within(row).getByText('عميل')).toBeDefined();
    expect(mocks.getCashierSessionDetail).toHaveBeenCalledWith(14);
  });

  test('refuses a shift the actor may not read without pretending it is empty', async () => {
    mocks.getCashierSessionDetail.mockRejectedValue(new ApiError(403, {
      code: 'ERP_CASHIER_SESSION_NOT_OWNER',
      message: 'لا يمكن عرض وردية فتحها حساب كاشير آخر',
    }));
    renderView();

    expect(await screen.findByText('لا يمكن عرض وردية فتحها حساب كاشير آخر')).toBeDefined();
  });

  test('shows a shift that took no money as exactly that', async () => {
    mocks.getCashierSessionDetail.mockResolvedValue({ ...detail, invoices: [] });
    renderView();

    expect(await screen.findByText('لا توجد مبيعات في هذه الوردية')).toBeDefined();
  });
});
