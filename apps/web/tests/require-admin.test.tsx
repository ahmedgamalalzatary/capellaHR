import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { RequireAdmin } from '../src/features/auth';
import { ApiError } from '../src/lib/api/client';
import { createAppQueryClient } from '../src/providers';

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
      <RequireAdmin>
        <p>لوحة التحكم</p>
      </RequireAdmin>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RequireAdmin', () => {
  test('renders children for an admin session', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderGuard();
    await waitFor(() => expect(screen.getByText('لوحة التحكم')).toBeDefined());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test('redirects to /login when the session resolves as unauthenticated', async () => {
    getSessionMock.mockResolvedValue(null);
    renderGuard();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });

  test.each([
    [{ type: 'employee' }, 'هذا القسم مخصص للمدير فقط.'],
    [{ type: 'cashier', accountId: 1, employeeId: 7 }, 'هذا الحساب غير مخوّل بالدخول إلى نظام الموارد البشرية.'],
  ])('shows a safe wrong-role state for a %s session', async (actor, message) => {
    getSessionMock.mockResolvedValue({ actor });

    renderGuard();

    await waitFor(() => expect(screen.getByText(message)).toBeDefined());
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.queryByText('لوحة التحكم')).toBeNull();
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
    await waitFor(() => expect(screen.getByText('لوحة التحكم')).toBeDefined());
  });

  // The retry it waits on can use the full 5s budget, so the test needs more than
  // vitest's 5s default or it races itself when the whole monorepo runs at once.
  test('recovers automatically from one transient session-check failure', { timeout: 20_000 }, async () => {
    getSessionMock
      .mockRejectedValueOnce(new ApiError(0, {
        code: 'NETWORK_ERROR',
        message: 'تعذر الاتصال بالخادم.',
      }))
      .mockResolvedValue({ actor: { type: 'admin' } });

    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <RequireAdmin>
          <p>لوحة التحكم</p>
        </RequireAdmin>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('لوحة التحكم')).toBeDefined(), { timeout: 5_000 });
    expect(getSessionMock).toHaveBeenCalledTimes(2);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
