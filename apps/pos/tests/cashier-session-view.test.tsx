import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getSession: vi.fn(),
  getCurrentCashierSession: vi.fn(),
  openCashierSession: vi.fn(),
  closeCashierSession: vi.fn(),
  recoveryCloseCashierSession: vi.fn(),
  listCashierSessionBranches: vi.fn(),
  getCashierSessionSummary: vi.fn(),
  listCashierSessions: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: mocks.getSession,
}));

vi.mock('../src/features/cashier-sessions/api/cashier-sessions-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCurrentCashierSession: mocks.getCurrentCashierSession,
  openCashierSession: mocks.openCashierSession,
  closeCashierSession: mocks.closeCashierSession,
  recoveryCloseCashierSession: mocks.recoveryCloseCashierSession,
  listCashierSessionBranches: mocks.listCashierSessionBranches,
  getCashierSessionSummary: mocks.getCashierSessionSummary,
  listCashierSessions: mocks.listCashierSessions,
}));

import { CashierSessionView } from '../src/features/cashier-sessions';

const session = {
  id: 14,
  branchId: 3,
  branchName: 'الفرع الرئيسي',
  openedByAccountId: 8,
  openedByUsername: 'cashier.one',
  openedAt: '2026-08-01T09:30:00.000Z',
  closedAt: null,
  closedByAccountId: null,
  closedByUsername: null,
};

const summary = {
  ...session,
  autoClosedAt: null,
  durationMinutes: 90,
  saleCount: 2,
  taken: { cash: '400.00', visa: '100.00', instapay: '0.00', vodafone_cash: '0.00' },
  refunded: { cash: '50.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00' },
  takenTotal: '500.00',
  refundedTotal: '50.00',
  net: '450.00',
};

const pageOf = (items: unknown[]) => ({
  items,
  meta: { page: 1, pageSize: 100, total: items.length, totalPages: 1 },
});

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CashierSessionView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getSession.mockResolvedValue({
    actor: { type: 'cashier', accountId: 8, employeeId: 7 },
  });
  mocks.getCurrentCashierSession.mockResolvedValue(null);
  mocks.openCashierSession.mockResolvedValue(session);
  mocks.closeCashierSession.mockResolvedValue({
    ...session,
    closedAt: '2026-08-01T10:00:00.000Z',
    closedByAccountId: 8,
    closedByUsername: 'cashier.one',
  });
  mocks.recoveryCloseCashierSession.mockResolvedValue({
    ...session,
    closedAt: '2026-08-01T10:00:00.000Z',
    closedByAccountId: 1,
    closedByUsername: 'admin@capella.test',
  });
  mocks.getCashierSessionSummary.mockResolvedValue(summary);
  mocks.listCashierSessions.mockResolvedValue({
    items: [],
    meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
  });
  mocks.listCashierSessionBranches.mockResolvedValue(pageOf([
    { id: 3, name: 'الفرع الرئيسي' },
    { id: 4, name: 'فرع المعادي' },
  ]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CashierSessionView', () => {
  test('announces cashier-session loading', async () => {
    mocks.getCurrentCashierSession.mockReturnValue(new Promise(() => undefined));
    renderView();

    expect(await screen.findByRole('status', { name: 'جارٍ تحميل الوردية…' })).toBeDefined();
  });

  test('restores and displays the acting Cashier open session with a Cairo timestamp', async () => {
    mocks.getCurrentCashierSession.mockResolvedValue(session);
    renderView();

    expect(await screen.findByText('الفرع الرئيسي')).toBeDefined();
    expect(screen.getByText('cashier.one')).toBeDefined();
    const openedAt = screen.getByText(/١٢:٣٠ م/);
    expect(openedAt.getAttribute('datetime')).toBe(session.openedAt);
    expect(mocks.getCurrentCashierSession).toHaveBeenCalledWith(undefined);
  });

  test('offers the owning Cashier a direct path from an open session to a new sale', async () => {
    mocks.getCurrentCashierSession.mockResolvedValue(session);
    renderView();

    const startSale = await screen.findByRole('link', { name: 'بدء بيع جديد' });
    expect(startSale.getAttribute('href')).toBe('/sales');
  });

  test('opens a session when the Cashier branch has no active session', async () => {
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'فتح الوردية' }));
    await waitFor(() => expect(mocks.openCashierSession).toHaveBeenCalledTimes(1));
  });

  test('closes the owned session only after confirmation', async () => {
    mocks.getCurrentCashierSession.mockResolvedValue(session);
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'إغلاق الوردية' }));
    expect(mocks.closeCashierSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد إغلاق الوردية' }));
    await waitFor(() => expect(mocks.closeCashierSession).toHaveBeenCalledTimes(1));
    expect(mocks.push).toHaveBeenCalledWith('/cashier-sessions/14/report');
  });

  test('refreshes stale state when normal close finds the session already gone', async () => {
    mocks.getCurrentCashierSession
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(null);
    mocks.closeCashierSession.mockRejectedValue(new ApiError(409, {
      code: 'ERP_CASHIER_SESSION_NOT_OPEN',
      message: 'لا توجد وردية كاشير مفتوحة لهذا الفرع',
    }));
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'إغلاق الوردية' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد إغلاق الوردية' }));
    expect(await screen.findByText('لا توجد وردية مفتوحة')).toBeDefined();
    expect(screen.queryByRole('dialog', { name: 'إغلاق وردية الكاشير' })).toBeNull();
    expect(mocks.getCurrentCashierSession).toHaveBeenCalledTimes(2);
  });

  test('refreshes stale state when another Cashier now owns the branch session', async () => {
    mocks.getCurrentCashierSession
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({
        ...session,
        id: 15,
        openedByAccountId: 9,
        openedByUsername: 'cashier.two',
      });
    mocks.closeCashierSession.mockRejectedValue(new ApiError(403, {
      code: 'ERP_CASHIER_SESSION_NOT_OWNER',
      message: 'لا يمكن إغلاق وردية فتحها حساب كاشير آخر',
    }));
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'إغلاق الوردية' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد إغلاق الوردية' }));

    expect(await screen.findByText('cashier.two')).toBeDefined();
    expect(screen.queryByRole('dialog', { name: 'إغلاق وردية الكاشير' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'إغلاق الوردية' })).toBeNull();
    expect(mocks.getCurrentCashierSession).toHaveBeenCalledTimes(2);
  });

  test('keeps the close confirmation open and shows an unexpected server failure', async () => {
    mocks.getCurrentCashierSession.mockResolvedValue(session);
    mocks.closeCashierSession.mockRejectedValue(new ApiError(500, {
      code: 'UNEXPECTED_ERROR',
      message: 'تعذر إغلاق الوردية',
    }));
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'إغلاق الوردية' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد إغلاق الوردية' }));
    const dialog = screen.getByRole('dialog', { name: 'إغلاق وردية الكاشير' });
    expect((await within(dialog).findByRole('alert')).textContent)
      .toContain('تعذر إغلاق الوردية');
  });

  test('shows active ownership and blocks another Cashier from closing it', async () => {
    mocks.getCurrentCashierSession.mockResolvedValue({
      ...session,
      openedByAccountId: 9,
      openedByUsername: 'cashier.two',
    });
    renderView();

    expect(await screen.findByText('الوردية مفتوحة بواسطة كاشير آخر')).toBeDefined();
    expect(screen.getByText('cashier.two')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'إغلاق الوردية' })).toBeNull();
  });

  test('surfaces a stable second-session conflict from the server', async () => {
    mocks.getCurrentCashierSession
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...session,
        openedByAccountId: 9,
        openedByUsername: 'cashier.two',
      });
    mocks.openCashierSession.mockRejectedValue(new ApiError(409, {
      code: 'ERP_CASHIER_SESSION_ALREADY_OPEN',
      message: 'توجد وردية كاشير مفتوحة بالفعل لهذا الفرع',
    }));
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'فتح الوردية' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'توجد وردية كاشير مفتوحة بالفعل لهذا الفرع',
    );
    expect(await screen.findByText('cashier.two')).toBeDefined();
    expect(mocks.getCurrentCashierSession).toHaveBeenCalledTimes(2);
  });

  test('shows a retry action when the current session cannot be loaded', async () => {
    mocks.getCurrentCashierSession.mockRejectedValueOnce(new ApiError(500, {
      code: 'UNEXPECTED_ERROR',
      message: 'تعذر تحميل الوردية',
    })).mockResolvedValueOnce(null);
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' }));
    await waitFor(() => expect(mocks.getCurrentCashierSession).toHaveBeenCalledTimes(2));
  });

  test('lets an Admin select a branch and recovery-close with a trimmed mandatory reason', async () => {
    mocks.getSession.mockResolvedValue({ actor: { type: 'admin' } });
    mocks.getCurrentCashierSession.mockResolvedValue(session);
    renderView();

    const branchSelect = await screen.findByLabelText('الفرع');
    expect(within(branchSelect).getByText('اختر الفرع')).toBeDefined();
    expect(mocks.getCurrentCashierSession).not.toHaveBeenCalled();
    await screen.findByRole('option', { name: 'الفرع الرئيسي' });
    fireEvent.change(branchSelect, { target: { value: '3' } });

    fireEvent.click(await screen.findByRole('button', { name: 'إغلاق استثنائي' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإغلاق الاستثنائي' }));
    const validation = await screen.findByRole('alert');
    expect(validation.textContent).toContain('سبب الإغلاق الاستثنائي مطلوب');
    expect(screen.getByLabelText('سبب الإغلاق الاستثنائي').getAttribute('aria-describedby'))
      .toBe(validation.id);
    expect(mocks.recoveryCloseCashierSession).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('سبب الإغلاق الاستثنائي'), {
      target: { value: '  تعطل جهاز الكاشير  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإغلاق الاستثنائي' }));
    await waitFor(() => expect(mocks.recoveryCloseCashierSession).toHaveBeenCalledWith(14, {
      reason: 'تعطل جهاز الكاشير',
    }));
  });

  test('refreshes an Admin branch when recovery-close finds the session already closed', async () => {
    mocks.getSession.mockResolvedValue({ actor: { type: 'admin' } });
    mocks.getCurrentCashierSession
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(null);
    mocks.recoveryCloseCashierSession.mockRejectedValue(new ApiError(409, {
      code: 'ERP_CASHIER_SESSION_ALREADY_CLOSED',
      message: 'وردية الكاشير مغلقة بالفعل',
    }));
    renderView();

    const branchSelect = await screen.findByLabelText('الفرع');
    await screen.findByRole('option', { name: 'الفرع الرئيسي' });
    fireEvent.change(branchSelect, { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: 'إغلاق استثنائي' }));
    fireEvent.change(screen.getByLabelText('سبب الإغلاق الاستثنائي'), {
      target: { value: 'تعطل الجهاز' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإغلاق الاستثنائي' }));

    expect(await screen.findByText('لا توجد وردية مفتوحة')).toBeDefined();
    expect(screen.queryByRole('dialog', { name: 'تأكيد الإغلاق الاستثنائي' })).toBeNull();
    expect(mocks.getCurrentCashierSession).toHaveBeenCalledTimes(2);
  });

  test('keeps keyboard focus contained inside the recovery dialog', async () => {
    mocks.getSession.mockResolvedValue({ actor: { type: 'admin' } });
    mocks.getCurrentCashierSession.mockResolvedValue(session);
    renderView();

    const branchSelect = await screen.findByLabelText('الفرع');
    await screen.findByRole('option', { name: 'الفرع الرئيسي' });
    fireEvent.change(branchSelect, { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: 'إغلاق استثنائي' }));

    const dialog = screen.getByRole('dialog', { name: 'تأكيد الإغلاق الاستثنائي' });
    const reason = screen.getByLabelText('سبب الإغلاق الاستثنائي');
    const cancel = within(dialog).getByRole('button', { name: 'إلغاء' });
    cancel.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(reason);
    reason.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  test('retains focus in the recovery dialog while every action is pending', async () => {
    mocks.getSession.mockResolvedValue({ actor: { type: 'admin' } });
    mocks.getCurrentCashierSession.mockResolvedValue(session);
    mocks.recoveryCloseCashierSession.mockReturnValue(new Promise(() => undefined));
    renderView();

    const branchSelect = await screen.findByLabelText('الفرع');
    await screen.findByRole('option', { name: 'الفرع الرئيسي' });
    fireEvent.change(branchSelect, { target: { value: '3' } });
    fireEvent.click(await screen.findByRole('button', { name: 'إغلاق استثنائي' }));
    const reason = screen.getByLabelText('سبب الإغلاق الاستثنائي');
    fireEvent.change(reason, { target: { value: 'تعطل الجهاز' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإغلاق الاستثنائي' }));

    const dialog = screen.getByRole('dialog', { name: 'تأكيد الإغلاق الاستثنائي' });
    await waitFor(() => expect(reason.hasAttribute('disabled')).toBe(true));
    dialog.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(dialog);
  });

  test('shows the open shift its running money, split by method', async () => {
    mocks.getCurrentCashierSession.mockResolvedValue(session);
    renderView();

    const totals = await screen.findByRole('region', { name: 'حركة الوردية' });
    expect(within(totals).getByText('450.00 ج.م')).toBeDefined();
    expect(within(totals).getByText('2')).toBeDefined();
    // Both directions are visible per method, because a till can hand back money
    // on a method it never took in.
    expect(within(totals).getByText('400.00 ج.م')).toBeDefined();
    expect(within(totals).getAllByText('50.00 ج.م')).toHaveLength(2);
    expect(mocks.getCashierSessionSummary).toHaveBeenCalledWith(14);
  });

  test('leaves the money out until there is an open shift to count', async () => {
    renderView();

    expect(await screen.findByRole('button', { name: 'فتح الوردية' })).toBeDefined();
    expect(screen.queryByRole('region', { name: 'حركة الوردية' })).toBeNull();
    expect(mocks.getCashierSessionSummary).not.toHaveBeenCalled();
  });
});
