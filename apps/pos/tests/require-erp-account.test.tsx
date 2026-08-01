import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { RequireErpAccount } from '../src/features/auth';

const { replaceMock, getSessionMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: replaceMock, replace: replaceMock }),
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: getSessionMock,
}));

function renderGuard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RequireErpAccount>
        <p>الصفحة المحمية</p>
      </RequireErpAccount>
    </QueryClientProvider>,
  );
}

function renderAdminOnlyGuard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RequireErpAccount role="admin">
        <p>الصفحة المحمية</p>
      </RequireErpAccount>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RequireErpAccount', () => {
  test('renders children for an admin session', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderGuard();
    await waitFor(() => expect(screen.getByText('الصفحة المحمية')).toBeDefined());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test('renders children for a cashier session', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderGuard();
    await waitFor(() => expect(screen.getByText('الصفحة المحمية')).toBeDefined());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test('redirects to /login when the session resolves as unauthenticated', async () => {
    getSessionMock.mockResolvedValue(null);
    renderGuard();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });

  test('shows an Arabic unauthorized-role message for an employee session instead of redirecting', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'employee' } });
    renderGuard();
    await waitFor(() =>
      expect(screen.getByText('هذا الحساب غير مخوّل بالدخول إلى نقطة البيع.')).toBeDefined(),
    );
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.queryByText('الصفحة المحمية')).toBeNull();
  });

  test('shows a retryable error instead of redirecting when the session check fails', async () => {
    getSessionMock.mockRejectedValue(new TypeError('fetch failed'));
    renderGuard();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeDefined(),
    );
    expect(replaceMock).not.toHaveBeenCalled();

    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    await waitFor(() => expect(screen.getByText('الصفحة المحمية')).toBeDefined());
  });

  test('role="admin" renders children for an admin session', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderAdminOnlyGuard();
    await waitFor(() => expect(screen.getByText('الصفحة المحمية')).toBeDefined());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test('role="admin" shows an Arabic admin-only message for a cashier session instead of redirecting', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderAdminOnlyGuard();
    await waitFor(() =>
      expect(screen.getByText('هذا القسم مخصص للمدير فقط.')).toBeDefined(),
    );
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.queryByText('الصفحة المحمية')).toBeNull();
  });
});
