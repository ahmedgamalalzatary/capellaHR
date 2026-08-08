import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { RedirectSignedInAdmin } from '../src/features/auth';

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

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RedirectSignedInAdmin>
        <p>نموذج تسجيل الدخول</p>
      </RedirectSignedInAdmin>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RedirectSignedInAdmin', () => {
  test('sends an already signed-in admin to the dashboard instead of the login form', async () => {
    getSessionMock.mockResolvedValue({ actor: { type: 'admin' } });

    renderLogin();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('نموذج تسجيل الدخول')).toBeNull();
  });

  test('shows the login form when there is no session', async () => {
    getSessionMock.mockResolvedValue(null);

    renderLogin();

    await waitFor(() => expect(screen.getByText('نموذج تسجيل الدخول')).toBeDefined());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test('shows the login form when the session check fails, so sign-in stays reachable', async () => {
    getSessionMock.mockRejectedValue(new TypeError('fetch failed'));

    renderLogin();

    await waitFor(() => expect(screen.getByText('نموذج تسجيل الدخول')).toBeDefined());
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
