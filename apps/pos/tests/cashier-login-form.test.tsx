import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';

import { CashierLoginForm } from '../src/features/auth';
import { ApiError } from '../src/lib/api/client';

const { pushMock, cashierLoginMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  cashierLoginMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock }),
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cashierLogin: cashierLoginMock,
}));

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...render(<CashierLoginForm />, { wrapper }) };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CashierLoginForm', () => {
  test('renders Arabic username and password fields', () => {
    renderForm();
    expect(screen.getByLabelText(/اسم المستخدم/)).toBeDefined();
    expect(screen.getByLabelText(/كلمة المرور/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'تسجيل الدخول' })).toBeDefined();
  });

  test('shows an Arabic validation error for an empty username without calling the API', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('اسم المستخدم مطلوب');
    });
    expect(cashierLoginMock).not.toHaveBeenCalled();
  });

  test('submits credentials and redirects to the POS home on success', async () => {
    cashierLoginMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    renderForm();
    fireEvent.change(screen.getByLabelText(/اسم المستخدم/), { target: { value: 'Cashier1' } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    await waitFor(() => {
      expect(cashierLoginMock.mock.calls[0]?.[0]).toEqual({
        username: 'cashier1',
        password: 'secret123',
      });
      expect(pushMock).toHaveBeenCalledWith('/');
    });
  });

  test('clears stale cached queries from a previous session on successful login', async () => {
    cashierLoginMock.mockResolvedValue({ actor: { type: 'cashier', accountId: 1, employeeId: 7 } });
    const { queryClient } = renderForm();
    queryClient.setQueryData(['cashier-accounts', 'list', {}], { items: [], total: 0 });

    fireEvent.change(screen.getByLabelText(/اسم المستخدم/), { target: { value: 'cashier1' } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
    expect(queryClient.getQueryData(['cashier-accounts', 'list', {}])).toBeUndefined();
  });

  test('shows the API Arabic error message on failed login', async () => {
    cashierLoginMock.mockRejectedValue(
      new ApiError(401, { code: 'INVALID_CREDENTIALS', message: 'بيانات تسجيل الدخول غير صحيحة' }),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText(/اسم المستخدم/), { target: { value: 'cashier1' } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('بيانات تسجيل الدخول غير صحيحة');
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  test('shows the throttled Arabic error message after too many attempts', async () => {
    cashierLoginMock.mockRejectedValue(
      new ApiError(429, { code: 'TOO_MANY_ATTEMPTS', message: 'محاولات كثيرة، حاول مرة أخرى لاحقاً' }),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText(/اسم المستخدم/), { target: { value: 'cashier1' } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('محاولات كثيرة، حاول مرة أخرى لاحقاً');
    });
  });
});
