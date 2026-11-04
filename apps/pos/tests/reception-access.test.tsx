import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ErpHomeView } from '../src/components/shell/erp-home-view';
import { PosShell } from '../src/components/shell/pos-shell';
import { ReceptionGate } from '../src/components/shell/reception-gate';
import SuppliersLayout from '../src/app/(protected)/suppliers/layout';
import { RequireErpAccount, useCanEdit } from '../src/features/auth';

const { replaceMock, getSessionMock, getCurrentSessionMock, pathname } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  getSessionMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  pathname: { current: '/' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: replaceMock, replace: replaceMock }),
  usePathname: () => pathname.current,
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: getSessionMock,
}));

vi.mock('../src/features/cashier-sessions/api/cashier-sessions-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCurrentCashierSession: getCurrentSessionMock,
}));

const openShift = {
  id: 9,
  branchId: 3,
  branchName: 'فرع مدينة نصر',
  openedByAccountId: 21,
  openedByUsername: 'cashier.one',
  openedAt: '2026-11-02T08:00:00.000Z',
  closedAt: null,
  closedByAccountId: null,
  closedByUsername: null,
  autoClosedAt: null,
};

const renderWithQuery = (children: ReactNode) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
};

function CanEditProbe() {
  return <p>{useCanEdit() ? 'يمكن التعديل' : 'عرض فقط'}</p>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

beforeEach(() => {
  pathname.current = '/';
  getSessionMock.mockResolvedValue({ actor: { type: 'reception', accountId: 22 } });
  getCurrentSessionMock.mockResolvedValue(openShift);
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false, media: '(min-width: 48rem)', onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
});

describe('reception login', () => {
  test('gets only the shift, the front-desk pages and suppliers in its menu', async () => {
    renderWithQuery(<PosShell><p>المحتوى</p></PosShell>);

    await screen.findByText('حساب استقبال');
    const hrefs = screen.getAllByRole('link')
      .map((link) => new URL((link as HTMLAnchorElement).href).pathname);
    expect(new Set(hrefs)).toEqual(new Set([
      '/', '/invoices', '/bookings', '/clients', '/catalog', '/products', '/consumables', '/suppliers',
    ]));
    expect(screen.queryByRole('link', { name: 'العمولات' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'بيع جديد' })).toBeNull();
    expect(await screen.findByText('الوردية مفتوحة')).toBeDefined();
  });

  test('is told to ask the cashier, not offered to open a shift, when none is open', async () => {
    getCurrentSessionMock.mockResolvedValue(null);
    renderWithQuery(<PosShell><p>المحتوى</p></PosShell>);

    expect(await screen.findByText('لا توجد وردية مفتوحة')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'فتح الوردية' })).toBeNull();
  });

  test.each(['/sales', '/commissions', '/expenses', '/cashier-sessions', '/refunds', '/transfers'])(
    'is refused on %s',
    async (path) => {
      pathname.current = path;
      renderWithQuery(<ReceptionGate><p>صفحة محمية</p></ReceptionGate>);

      expect(await screen.findByText('هذه الصفحة غير متاحة لحساب الاستقبال.')).toBeDefined();
      expect(screen.queryByText('صفحة محمية')).toBeNull();
    },
  );

  test.each(['/invoices', '/invoices/12', '/bookings', '/clients', '/catalog', '/products', '/consumables', '/suppliers'])(
    'works on %s while the shared shift is open',
    async (path) => {
      pathname.current = path;
      renderWithQuery(<ReceptionGate><p>صفحة الاستقبال</p></ReceptionGate>);

      expect(await screen.findByText('صفحة الاستقبال')).toBeDefined();
    },
  );

  test.each(['/clients', '/suppliers'])('is held on %s until the cashier opens the shift', async (path) => {
    pathname.current = path;
    getCurrentSessionMock.mockResolvedValue(null);
    renderWithQuery(<ReceptionGate><p>صفحة الاستقبال</p></ReceptionGate>);

    expect(await screen.findByText('لا توجد وردية مفتوحة. اطلب من الكاشير فتح الوردية.')).toBeDefined();
    expect(screen.queryByText('صفحة الاستقبال')).toBeNull();
  });

  test('passes other accounts straight through the reception gate', async () => {
    pathname.current = '/commissions';
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 21 } });
    renderWithQuery(<ReceptionGate><p>صفحة الكاشير</p></ReceptionGate>);

    expect(await screen.findByText('صفحة الكاشير')).toBeDefined();
    expect(getCurrentSessionMock).not.toHaveBeenCalled();
  });

  test('sees only the status of the shared shift on its home screen', async () => {
    renderWithQuery(<ErpHomeView />);

    expect(await screen.findByText('الوردية مفتوحة')).toBeDefined();
    expect(screen.getByText('cashier.one')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/نقدي|الدرج|إغلاق/)).toBeNull();
  });

  test('sees on its home screen that the cashier must open the shift', async () => {
    getCurrentSessionMock.mockResolvedValue(null);
    renderWithQuery(<ErpHomeView />);

    expect(await screen.findByText('لا توجد وردية مفتوحة. اطلب من الكاشير فتح الوردية.')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('passes only the guards that admit reception', async () => {
    renderWithQuery(
      <>
        <RequireErpAccount reception><p>مسموح</p></RequireErpAccount>
        <RequireErpAccount><p>ممنوع</p></RequireErpAccount>
      </>,
    );

    expect(await screen.findByText('مسموح')).toBeDefined();
    expect(screen.queryByText('ممنوع')).toBeNull();
    await waitFor(() => expect(replaceMock).not.toHaveBeenCalled());
  });

  test('is let onto the suppliers page', async () => {
    renderWithQuery(<SuppliersLayout><p>الموردون</p></SuppliersLayout>);

    expect(await screen.findByText('الموردون')).toBeDefined();
  });

  test('is read-only while cashier and admin can still edit', async () => {
    renderWithQuery(<CanEditProbe />);
    expect(await screen.findByText('عرض فقط')).toBeDefined();
    cleanup();

    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 21 } });
    renderWithQuery(<CanEditProbe />);
    expect(await screen.findByText('يمكن التعديل')).toBeDefined();
  });
});
