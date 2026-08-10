import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { LoginView } from '../src/features/auth';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function renderView() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <LoginView />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LoginView', () => {
  test('defaults to the cashier login form', () => {
    renderView();
    expect(screen.getByLabelText(/اسم المستخدم/)).toBeDefined();
    expect(screen.queryByLabelText(/البريد الإلكتروني/)).toBeNull();
  });

  test('switches to the admin login form when the admin button is selected', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'مدير' }));
    expect(screen.getByLabelText(/البريد الإلكتروني/)).toBeDefined();
    expect(screen.queryByLabelText(/اسم المستخدم/)).toBeNull();
  });

  test('switches back to the cashier login form when the cashier button is selected', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'مدير' }));
    fireEvent.click(screen.getByRole('button', { name: 'كاشير' }));
    expect(screen.getByLabelText(/اسم المستخدم/)).toBeDefined();
  });
});
