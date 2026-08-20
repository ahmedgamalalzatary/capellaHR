import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listCashierSessions: vi.fn(),
  listCashierSessionBranches: vi.fn(),
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: mocks.getSession,
}));

vi.mock('../src/features/cashier-sessions/api/cashier-sessions-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listCashierSessions: mocks.listCashierSessions,
  listCashierSessionBranches: mocks.listCashierSessionBranches,
}));

import { ShiftHistoryView } from '../src/features/cashier-sessions';

const shift = {
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
  saleCount: 2,
  taken: { cash: '400.00', visa: '100.00', instapay: '0.00', vodafone_cash: '0.00' },
  refunded: { cash: '50.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
  takenTotal: '500.00',
  refundedTotal: '50.00',
  net: '450.00',
};

const pageOf = (items: unknown[], page = 1, total = items.length) => ({
  items,
  meta: { page, pageSize: 10, total, totalPages: Math.ceil(total / 10) },
});

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ShiftHistoryView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getSession.mockResolvedValue({ actor: { type: 'cashier', accountId: 8, employeeId: 7 } });
  mocks.listCashierSessions.mockResolvedValue(pageOf([shift]));
  mocks.listCashierSessionBranches.mockResolvedValue({
    items: [{ id: 3, name: 'الفرع الرئيسي' }],
    meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShiftHistoryView', () => {
  test('lists a past shift with how long it ran and what it netted', async () => {
    renderView();

    const row = await screen.findByRole('listitem');
    expect(within(row).getByText('8 س 0 د')).toBeDefined();
    expect(within(row).getByText('450.00 ج.م')).toBeDefined();
    expect(within(row).getByRole('link', { name: /تفاصيل الوردية/ }).getAttribute('href'))
      .toBe('/cashier-sessions/14');
  });

  test('names the shift the system ended, so nobody looks for who closed it', async () => {
    mocks.listCashierSessions.mockResolvedValue(pageOf([{
      ...shift, closedByAccountId: null, closedByUsername: null,
      autoClosedAt: '2026-08-02T01:30:00.000Z',
    }]));
    renderView();

    expect(await screen.findByText('أُغلقت تلقائيًا')).toBeDefined();
  });

  test('pages back through older shifts', async () => {
    mocks.listCashierSessions.mockResolvedValue(pageOf([shift], 1, 25));
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'التالي' }));
    await waitFor(() => expect(mocks.listCashierSessions).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    ));
  });

  test('says plainly when a till has no history yet', async () => {
    mocks.listCashierSessions.mockResolvedValue(pageOf([]));
    renderView();

    expect(await screen.findByText('لا توجد ورديات سابقة')).toBeDefined();
  });

  test('asks no second branch question when the screen around it already did', async () => {
    mocks.getSession.mockResolvedValue({ actor: { type: 'admin', accountId: 1 } });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftHistoryView branchId={3} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocks.listCashierSessions)
      .toHaveBeenCalledWith(expect.objectContaining({ branchId: 3 })));
    expect(screen.queryByLabelText('الفرع')).toBeNull();
    expect(mocks.listCashierSessionBranches).not.toHaveBeenCalled();
  });
});
