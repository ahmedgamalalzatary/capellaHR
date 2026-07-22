import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  employeeLogin: vi.fn(),
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  employeeLogin: mocks.employeeLogin,
}));

import { EmployeeLoginForm } from '../src/features/auth/components/employee-login-form';
import { SESSION_QUERY_KEY } from '../src/features/auth/hooks/use-session';

function renderForm(onSuccess?: () => void) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <EmployeeLoginForm {...(onSuccess ? { onSuccess } : {})} />
    </QueryClientProvider>,
  );
  return { queryClient, ...rendered };
}

const fillAndSubmit = () => {
  fireEvent.change(screen.getByLabelText(/كود الموظف/), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText(/الرقم السري/), { target: { value: '1234' } });
  fireEvent.change(screen.getByLabelText(/رقم الهاتف الشخصي/), { target: { value: '01012345678' } });
  fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));
};

beforeEach(() => {
  window.localStorage.clear();
  mocks.employeeLogin.mockResolvedValue({ actor: { type: 'employee' } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EmployeeLoginForm', () => {
  test('logs in silently with the paired browser marker', async () => {
    const onSuccess = vi.fn();
    renderForm(onSuccess);
    fillAndSubmit();

    await waitFor(() => expect(mocks.employeeLogin).toHaveBeenCalledTimes(1));
    const payload = mocks.employeeLogin.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ employeeCode: 7, pin: '1234', personalPhone: '01012345678' });
    expect((payload['installationMarker'] as string).length).toBeGreaterThanOrEqual(16);
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  test('publishes the employee session immediately after login', async () => {
    const { queryClient } = renderForm();
    fillAndSubmit();

    await waitFor(() => expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual({
      actor: { type: 'employee' },
    }));
  });

  test('shows the Arabic message for an unregistered device', async () => {
    mocks.employeeLogin.mockRejectedValue(
      new ApiError(401, { code: 'DEVICE_NOT_REGISTERED', message: 'تعذر التحقق من الجهاز' }),
    );
    renderForm();
    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'تعذر التحقق من الجهاز',
    );
  });

  test('displays the backend login message without replacing it by error code', async () => {
    mocks.employeeLogin.mockRejectedValue(
      new ApiError(401, {
        code: 'DEVICE_NOT_REGISTERED',
        message: 'رسالة الجهاز المعتمدة من الخادم',
      }),
    );
    renderForm();
    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'رسالة الجهاز المعتمدة من الخادم',
    );
  });

  test('rejects Arabic-Indic phone digits with a Western-digit instruction', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/كود الموظف/), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText(/الرقم السري/), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText(/رقم الهاتف الشخصي/), {
      target: { value: '٠١٠١٢٣٤٥٦٧٨' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'استخدم الأرقام الإنجليزية من 0 إلى 9',
    );
    expect(mocks.employeeLogin).not.toHaveBeenCalled();
  });
});
