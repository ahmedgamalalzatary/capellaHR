import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProtectedAreaGate } from '../src/features/protected-area/components/protected-area-gate';
import { SESSION_QUERY_KEY } from '../src/features/auth';

const router = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));

const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
}));

const renderGate = (area: Parameters<typeof ProtectedAreaGate>[0]['area'], content: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ProtectedAreaGate area={area}>
        <p>{content}</p>
      </ProtectedAreaGate>
    </QueryClientProvider>,
  );
  return queryClient;
};

beforeEach(() => {
  sessionStorage.clear();
  router.back.mockReset();
  router.replace.mockReset();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ProtectedAreaGate', () => {
  it('returns to the dashboard instead of leaving the application', async () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(2);

    renderGate('employees', 'employee content');

    fireEvent.click(await screen.findByRole('button', { name: 'رجوع' }));
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('returns to the dashboard when the protected page has no previous history', async () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);

    renderGate('employees', 'employee content');

    fireEvent.click(await screen.findByRole('button', { name: 'رجوع' }));
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('unlocks only the requested area for the current browser tab', async () => {
    vi.mocked(fetch).mockReturnValue(response({ unlocked: true }));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ProtectedAreaGate area="employees">
          <p>employee content</p>
        </ProtectedAreaGate>
      </QueryClientProvider>,
    );

    expect(screen.queryByText('employee content')).toBeNull();
    fireEvent.change(screen.getByLabelText('كلمة مرور الوصول'), {
      target: { value: 'Cap2255' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'فتح القسم' }));

    expect(await screen.findByText('employee content')).toBeDefined();
    expect(fetch).toHaveBeenCalledWith('/protected-area-access', expect.anything());
    expect(sessionStorage.getItem('capella:protected-area:employees')).toBe('unlocked');
    expect(sessionStorage.getItem('capella:protected-area:reports')).toBeNull();

    rerender(
      <QueryClientProvider client={queryClient}>
        <ProtectedAreaGate area="reports">
          <p>reports content</p>
        </ProtectedAreaGate>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('reports content')).toBeNull();
  });

  it('keeps the area locked and shows an Arabic error for a wrong password', async () => {
    vi.mocked(fetch).mockReturnValue(response({ error: 'INVALID_PASSWORD' }, 401));

    renderGate('payroll', 'payroll content');

    fireEvent.change(screen.getByLabelText('كلمة مرور الوصول'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'فتح القسم' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'كلمة المرور غير صحيحة.',
    );
    expect(screen.queryByText('payroll content')).toBeNull();
    expect(sessionStorage.getItem('capella:protected-area:payroll')).toBeNull();
  });

  it('clears stale session state when the protected check reports an expired session', async () => {
    vi.mocked(fetch).mockReturnValue(response({ error: 'UNAUTHENTICATED' }, 401));
    const queryClient = renderGate('payroll', 'payroll content');
    queryClient.setQueryData(SESSION_QUERY_KEY, { actor: { type: 'admin' } });
    queryClient.setQueryData(['employees', 'protected'], { items: [] });

    fireEvent.change(screen.getByLabelText('كلمة مرور الوصول'), {
      target: { value: 'Cap2255' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'فتح القسم' }));

    await waitFor(() => expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull());
    expect(queryClient.getQueryData(['employees', 'protected'])).toBeUndefined();
    expect(screen.queryByText('كلمة المرور غير صحيحة.')).toBeNull();
    expect(sessionStorage.getItem('capella:protected-area:payroll')).toBeNull();
  });

  it('restores access after refresh in the same tab without checking again', async () => {
    sessionStorage.setItem('capella:protected-area:reports', 'unlocked');

    renderGate('reports', 'reports content');

    expect(await screen.findByText('reports content')).toBeDefined();
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });
});
