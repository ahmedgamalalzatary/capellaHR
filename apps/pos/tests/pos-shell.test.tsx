import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { PosShell } from '../src/components/shell/pos-shell';

const { replaceMock, getSessionMock, logoutMock, getCurrentSessionMock, pathname } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  getSessionMock: vi.fn(),
  logoutMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  pathname: { current: '/sales' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: replaceMock, replace: replaceMock }),
  usePathname: () => pathname.current,
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: getSessionMock,
  logout: logoutMock,
}));

vi.mock('../src/features/cashier-sessions/api/cashier-sessions-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCurrentCashierSession: getCurrentSessionMock,
}));

function PendingCommand() {
  const command = useMutation({ mutationFn: () => new Promise<void>(() => undefined) });
  return <button type="button" onClick={() => command.mutate()}>ابدأ الحفظ</button>;
}

function renderShell(children = <p>المحتوى</p>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PosShell>
        {children}
      </PosShell>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

beforeEach(() => {
  pathname.current = '/sales';
  getCurrentSessionMock.mockResolvedValue(null);
  // jsdom ships no matchMedia; the shell watches the md breakpoint to close the
  // mobile drawer, so tests run as a narrow viewport with the drawer available.
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false, media: '(min-width: 48rem)', onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
});

describe('PosShell', () => {
  test('renders the children content', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    expect(screen.getByText('المحتوى')).toBeDefined();
  });

  test('shows the cashier-accounts link for an admin actor', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderShell();
    expect(await screen.findByRole('link', { name: 'حسابات الكاشير' })).toBeDefined();
  });

  test('groups the complete Admin navigation by workflow', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderShell();

    const sales = await screen.findByRole('group', { name: 'المبيعات والعملاء' });
    const administration = screen.getByRole('group', { name: 'الإدارة' });
    const oversight = screen.getByRole('group', { name: 'المتابعة' });
    const system = screen.getByRole('group', { name: 'النظام' });

    expect(sales.textContent).toContain('الفواتير');
    expect(administration.textContent).toContain('الموردون والمشتريات');
    expect(oversight.textContent).toContain('التقارير');
    expect(system.textContent).toContain('حسابات الكاشير');
  });

  test('links Admins to the administration dashboard and session management', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderShell();

    expect((await screen.findByRole('link', { name: 'لوحة الإدارة' })).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'ورديات الكاشير والسجل' })).toHaveProperty(
      'href',
      expect.stringContaining('/cashier-sessions'),
    );
  });

  test('shows commission reporting only to an admin actor', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderShell();
    expect(await screen.findByRole('link', { name: 'العمولات' })).toHaveProperty('href', expect.stringContaining('/commissions'));

    cleanup();
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'العمولات' })).toBeNull());
  });

  test('shows ERP reports only to an admin actor', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderShell();
    expect(await screen.findByRole('link', { name: 'التقارير' }))
      .toHaveProperty('href', expect.stringContaining('/reports'));

    cleanup();
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'التقارير' })).toBeNull());
  });

  test('hides the cashier-accounts link for a cashier actor', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    await waitFor(() => expect(getSessionMock).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'حسابات الكاشير' })).toBeNull();
  });

  test('gives a cashier the same operating sections an admin has', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();

    for (const label of ['الكتالوج', 'المنتجات والمخزون', 'الموردون والمشتريات', 'المصروفات', 'العملاء']) {
      expect(await screen.findByRole('link', { name: label })).toBeDefined();
    }
  });

  test('hides the cashier-sessions oversight link from a cashier', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderShell();
    expect(await screen.findByRole('link', { name: 'ورديات الكاشير والسجل' })).toBeDefined();

    cleanup();
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'ورديات الكاشير والسجل' })).toBeNull());
  });

  test('shows the service-sale workflow link to every ERP account', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    const link = await screen.findByRole('link', { name: 'بيع جديد' });
    expect(link.getAttribute('href')).toBe('/sales');
  });

  test('shows the refunds workflow link to every ERP account', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderShell();
    expect((await screen.findByRole('link', { name: 'المرتجعات' })).getAttribute('href'))
      .toBe('/refunds');

    cleanup();
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    expect((await screen.findByRole('link', { name: 'المرتجعات' })).getAttribute('href'))
      .toBe('/refunds');
  });

  test('shows the expenses workflow link to every ERP account', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderShell();
    expect((await screen.findByRole('link', { name: 'المصروفات' })).getAttribute('href'))
      .toBe('/expenses');

    cleanup();
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    expect((await screen.findByRole('link', { name: 'المصروفات' })).getAttribute('href'))
      .toBe('/expenses');
  });

  test('keeps the fixed assets register on the admin rail only', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderShell();
    expect((await screen.findByRole('link', { name: 'الأصول الثابتة' })).getAttribute('href'))
      .toBe('/fixed-assets');

    cleanup();
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    await screen.findByRole('link', { name: 'المصروفات' });
    expect(screen.queryByRole('link', { name: 'الأصول الثابتة' })).toBeNull();
  });

  test('marks the active destination in the responsive primary navigation', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();

    const navigation = await screen.findByRole('navigation', { name: 'التنقل الرئيسي' });
    const active = screen.getByRole('link', { name: 'بيع جديد' });
    expect(navigation.contains(active)).toBe(true);
    expect(active.getAttribute('aria-current')).toBe('page');
  });

  test('shows the server-validated Cashier session state in the shell', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    getCurrentSessionMock.mockResolvedValue({
      id: 13,
      branchId: 2,
      branchName: 'الفرع الرئيسي',
      openedByAccountId: 1,
      openedByUsername: 'cashier1',
      openedAt: '2026-08-04T10:00:00.000Z',
    });
    renderShell();

    const sessionState = await screen.findByText('الوردية مفتوحة');
    expect(sessionState.parentElement?.textContent).toContain('الفرع الرئيسي');
  });

  test('logs out and redirects to /login', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    logoutMock.mockResolvedValue(undefined);
    localStorage.setItem('capella:sale-draft:admin:admin:2:13:key', '{}');
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }));
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
    expect(localStorage.getItem('capella:sale-draft:admin:admin:2:13:key')).toBeNull();
  });

  test('prevents shell navigation and logout while a command is pending', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderShell(<PendingCommand />);

    const destination = await screen.findByRole('link', { name: 'الكتالوج' });
    fireEvent.click(await screen.findByRole('button', { name: 'ابدأ الحفظ' }));

    await waitFor(() => expect(destination.getAttribute('aria-disabled')).toBe('true'));
    const navigation = new MouseEvent('click', { bubbles: true, cancelable: true });
    expect(destination.dispatchEvent(navigation)).toBe(false);
    expect(screen.getByRole('button', { name: 'تسجيل الخروج' })).toHaveProperty('disabled', true);
    expect(logoutMock).not.toHaveBeenCalled();
  });
});
