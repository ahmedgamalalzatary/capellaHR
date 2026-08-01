import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({
    actor: { type: 'cashier' as const, accountId: 8, employeeId: 7 },
  })),
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
  it('renders the Cashier-session feature instead of a placeholder', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'وردية الكاشير' })).toBeDefined();
    expect(screen.queryByText('قيد الإنشاء')).toBeNull();
  });
});
