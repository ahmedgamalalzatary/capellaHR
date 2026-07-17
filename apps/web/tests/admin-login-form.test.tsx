import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';

import { AdminLoginForm } from '../src/features/auth';
import { ApiError } from '../src/lib/api/client';

const { pushMock, adminLoginMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  adminLoginMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock }),
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  adminLogin: adminLoginMock,
}));

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<AdminLoginForm />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminLoginForm', () => {
  test('renders Arabic email and password fields', () => {
    renderForm();
    expect(screen.getByLabelText(/البريد الإلكتروني/)).toBeDefined();
    expect(screen.getByLabelText(/كلمة المرور/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'تسجيل الدخول' })).toBeDefined();
  });

  test('shows an Arabic validation error for an invalid email without calling the API', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/البريد الإلكتروني/), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('بريد إلكتروني غير صالح');
    });
    expect(adminLoginMock).not.toHaveBeenCalled();
  });

  test('submits credentials and redirects to the dashboard on success', async () => {
    adminLoginMock.mockResolvedValue({ actor: { type: 'admin' } });
    renderForm();
    fireEvent.change(screen.getByLabelText(/البريد الإلكتروني/), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: 'admin1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    await waitFor(() => {
      expect(adminLoginMock.mock.calls[0]?.[0]).toEqual({
        email: 'admin@example.com',
        password: 'admin1234',
      });
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  test('shows the API Arabic error message on failed login', async () => {
    adminLoginMock.mockRejectedValue(
      new ApiError(401, { code: 'INVALID_CREDENTIALS', message: 'بيانات تسجيل الدخول غير صحيحة' }),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText(/البريد الإلكتروني/), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/كلمة المرور/), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('بيانات تسجيل الدخول غير صحيحة');
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
