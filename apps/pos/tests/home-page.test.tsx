import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCurrentCashierSession: vi.fn(async () => null),
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSession: mocks.getSession,
}));

vi.mock('../src/features/cashier-sessions/api/cashier-sessions-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCurrentCashierSession: mocks.getCurrentCashierSession,
}));

import HomePage from '../src/app/(protected)/page';

afterEach(() => {
  cleanup();
});

describe('POS Cashier-session home page', () => {
  it('keeps the Cashier workspace hidden until the session resolves', () => {
    mocks.getSession.mockReturnValue(new Promise(() => undefined));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <HomePage />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('status', { name: 'جارٍ التحقق من الجلسة…' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'وردية الكاشير' })).toBeNull();
  });

  it('shows a retry state when session resolution fails', async () => {
    mocks.getSession.mockRejectedValue(new Error('network'));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <HomePage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('تعذر التحقق من الجلسة'),
    );
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'وردية الكاشير' })).toBeNull();
  });

  it('renders the complete administration workspace for an Admin', async () => {
    mocks.getSession.mockResolvedValue({ actor: { type: 'admin' as const } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'لوحة الإدارة' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'إدارة الكتالوج' })).toHaveProperty(
      'href',
      expect.stringContaining('/catalog'),
    );
    expect(screen.getByRole('link', { name: 'الموردون والمشتريات' })).toHaveProperty(
      'href',
      expect.stringContaining('/suppliers'),
    );
    expect(screen.getByRole('link', { name: 'التقارير والتصدير' })).toHaveProperty(
      'href',
      expect.stringContaining('/reports'),
    );
    expect(screen.queryByRole('heading', { name: 'وردية الكاشير' })).toBeNull();
  });

  it('renders the Cashier-session feature instead of a placeholder', async () => {
    mocks.getSession.mockResolvedValue({
      actor: { type: 'cashier' as const, accountId: 8, employeeId: 7 },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'وردية الكاشير' })).toBeDefined();
    expect(screen.queryByText('قيد الإنشاء')).toBeNull();
  });
});
