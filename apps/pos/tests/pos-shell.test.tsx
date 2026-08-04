import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { PosShell } from '../src/components/shell/pos-shell';

const { replaceMock, getSessionMock, logoutMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  getSessionMock: vi.fn(),
  logoutMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: replaceMock, replace: replaceMock }),
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: getSessionMock,
  logout: logoutMock,
}));

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PosShell>
        <p>المحتوى</p>
      </PosShell>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

  test('hides the cashier-accounts link for a cashier actor', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    await waitFor(() => expect(getSessionMock).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'حسابات الكاشير' })).toBeNull();
  });

  test('shows the catalog-administration link for an admin actor only', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderShell();
    expect(await screen.findByRole('link', { name: 'الكتالوج' })).toBeDefined();

    cleanup();
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'الكتالوج' })).toBeNull());
  });

  test('shows the service-browsing link to a cashier, who needs it to sell', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    expect(await screen.findByRole('link', { name: 'الخدمات' })).toBeDefined();
  });

  test('shows the service-sale workflow link to every ERP account', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderShell();
    const link = await screen.findByRole('link', { name: 'بيع جديد' });
    expect(link.getAttribute('href')).toBe('/sales');
  });

  test('logs out and redirects to /login', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    logoutMock.mockResolvedValue(undefined);
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }));
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });
});
