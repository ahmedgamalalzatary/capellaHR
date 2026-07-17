import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  employeeLogin: vi.fn(),
  getEmployeeDeviceOptions: vi.fn(),
  startAuthentication: vi.fn(),
}));

vi.mock('../src/features/auth/api/auth-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  employeeLogin: mocks.employeeLogin,
  getEmployeeDeviceOptions: mocks.getEmployeeDeviceOptions,
}));

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: mocks.startAuthentication,
}));

import { EmployeeLoginForm } from '../src/features/auth/components/employee-login-form';

const authenticationResponse = {
  id: 'cred-1',
  rawId: 'cred-1',
  type: 'public-key',
  response: { clientDataJSON: 'x', authenticatorData: 'y', signature: 'z' },
  clientExtensionResults: {},
};

function renderForm(onSuccess?: () => void) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EmployeeLoginForm {...(onSuccess ? { onSuccess } : {})} />
    </QueryClientProvider>,
  );
}

const fillAndSubmit = () => {
  fireEvent.change(screen.getByLabelText(/كود الموظف/), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText(/الرقم السري/), { target: { value: '1234' } });
  fireEvent.change(screen.getByLabelText(/رقم الهاتف الشخصي/), { target: { value: '01012345678' } });
  fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));
};

beforeEach(() => {
  window.localStorage.clear();
  mocks.getEmployeeDeviceOptions.mockResolvedValue({
    challengeId: 'chal-uuid-1',
    options: { challenge: 'c1' },
  });
  mocks.startAuthentication.mockResolvedValue(authenticationResponse);
  mocks.employeeLogin.mockResolvedValue({ actor: { type: 'employee', employeeId: 7 } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EmployeeLoginForm', () => {
  test('runs the device WebAuthn ceremony and logs in with the proof', async () => {
    const onSuccess = vi.fn();
    renderForm(onSuccess);
    fillAndSubmit();

    await waitFor(() => expect(mocks.employeeLogin).toHaveBeenCalledTimes(1));
    const optionsInput = mocks.getEmployeeDeviceOptions.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(optionsInput['employeeCode']).toBe(7);
    expect((optionsInput['installationMarker'] as string).length).toBeGreaterThanOrEqual(16);
    expect(mocks.startAuthentication.mock.calls[0]?.[0]).toEqual({
      optionsJSON: { challenge: 'c1' },
    });

    const payload = mocks.employeeLogin.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ employeeCode: 7, pin: '1234', personalPhone: '01012345678' });
    expect(payload['deviceProof']).toEqual({
      challengeId: 'chal-uuid-1',
      installationMarker: optionsInput['installationMarker'],
      response: authenticationResponse,
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  test('shows the Arabic message for an unregistered device', async () => {
    mocks.getEmployeeDeviceOptions.mockRejectedValue(
      new ApiError(409, { code: 'DEVICE_PROOF_INVALID', message: 'تعذر التحقق من إثبات الجهاز' }),
    );
    renderForm();
    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'تعذر التحقق من إثبات الجهاز',
    );
    expect(mocks.employeeLogin).not.toHaveBeenCalled();
  });
});
