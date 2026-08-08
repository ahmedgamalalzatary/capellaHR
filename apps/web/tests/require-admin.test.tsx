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

  test('recovers from a transient session-check failure without showing an error', async () => {
    getSessionMock
      .mockRejectedValueOnce(new ApiError(0, {
        code: 'NETWORK_ERROR',
        message: 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.',
      }))
      .mockResolvedValue({ actor: { type: 'admin' } });

    // The real client, not the retry-disabled one the other cases use: a laptop waking or
    // the API restarting should not strand a signed-in admin on an error screen.
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <RequireAdmin>
          <p>لوحة التحكم</p>
        </RequireAdmin>
      </QueryClientProvider>,
    );

    await waitFor(
      () => expect(screen.getByText('لوحة التحكم')).toBeDefined(),
      { timeout: 5_000 },
    );
    expect(replaceMock).not.toHaveBeenCalled();
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
});
