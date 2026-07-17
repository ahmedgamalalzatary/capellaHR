import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  getPairingOptions: vi.fn(),
  completeDevicePairing: vi.fn(),
  startRegistration: vi.fn(),
}));

vi.mock('../src/features/devices/api/devices-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPairingOptions: mocks.getPairingOptions,
  completeDevicePairing: mocks.completeDevicePairing,
}));

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: mocks.startRegistration,
}));

import { PairDeviceView } from '../src/features/devices/components/pair-device-view';

const optionsJSON = { challenge: 'chal-1', rp: { name: 'Capella HR', id: 'localhost' } };
const registrationResponse = {
  id: 'cred-1',
  rawId: 'cred-1',
  type: 'public-key',
  response: { clientDataJSON: 'x', attestationObject: 'y' },
  clientExtensionResults: {},
};

beforeEach(() => {
  vi.stubGlobal('PublicKeyCredential', class {});
  window.localStorage.clear();
  mocks.getPairingOptions.mockResolvedValue(optionsJSON);
  mocks.startRegistration.mockResolvedValue(registrationResponse);
  mocks.completeDevicePairing.mockResolvedValue({ id: 5, status: 'active' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const runCeremony = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'ابدأ الربط' }));
  await waitFor(() => expect(mocks.completeDevicePairing).toHaveBeenCalled());
};

describe('PairDeviceView', () => {
  test('runs the full WebAuthn ceremony and reports success', async () => {
    render(<PairDeviceView token="tok-live-1" />);
    await runCeremony();

    expect(mocks.getPairingOptions.mock.calls[0]?.[0]).toBe('tok-live-1');
    expect(mocks.startRegistration.mock.calls[0]?.[0]).toEqual({ optionsJSON });

    const [token, body] = mocks.completeDevicePairing.mock.calls[0] as [string, Record<string, unknown>];
    expect(token).toBe('tok-live-1');
    expect(body['response']).toBe(registrationResponse);
    expect(typeof body['installationMarker']).toBe('string');
    expect((body['installationMarker'] as string).length).toBeGreaterThanOrEqual(16);
    expect(typeof body['browser']).toBe('string');
    expect((body['browser'] as string).length).toBeGreaterThan(0);
    expect(typeof body['platform']).toBe('string');
    expect((body['platform'] as string).length).toBeGreaterThan(0);

    expect(await screen.findByText('تم ربط الجهاز بنجاح')).toBeDefined();
  });

  test('reuses the same installation marker across ceremonies', async () => {
    render(<PairDeviceView token="tok-a" />);
    await runCeremony();
    const first = (mocks.completeDevicePairing.mock.calls[0]?.[1] as Record<string, unknown>)['installationMarker'];
    cleanup();

    render(<PairDeviceView token="tok-b" />);
    fireEvent.click(screen.getByRole('button', { name: 'ابدأ الربط' }));
    await waitFor(() => expect(mocks.completeDevicePairing).toHaveBeenCalledTimes(2));
    const second = (mocks.completeDevicePairing.mock.calls[1]?.[1] as Record<string, unknown>)['installationMarker'];
    expect(second).toBe(first);
  });

  test('shows the Arabic server error and allows retrying', async () => {
    mocks.completeDevicePairing.mockRejectedValueOnce(
      new ApiError(409, { code: 'DEVICE_PAIRING_INVALID', message: 'طلب ربط الجهاز غير صالح' }),
    );
    render(<PairDeviceView token="tok-live-2" />);
    fireEvent.click(screen.getByRole('button', { name: 'ابدأ الربط' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'طلب ربط الجهاز غير صالح');

    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('تم ربط الجهاز بنجاح')).toBeDefined();
  });

  test('shows a friendly message when the phone cancels the WebAuthn prompt', async () => {
    mocks.startRegistration.mockRejectedValueOnce(new Error('NotAllowedError'));
    render(<PairDeviceView token="tok-live-3" />);
    fireEvent.click(screen.getByRole('button', { name: 'ابدأ الربط' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'تعذر إتمام الربط. حاول مرة أخرى أو اطلب رابطًا جديدًا من الإدارة.',
    );
    expect(mocks.completeDevicePairing).not.toHaveBeenCalled();
  });

  test('never exposes the raw pairing token on the page', async () => {
    const { container } = render(<PairDeviceView token="tok-secret-999" />);
    expect(container.textContent).not.toContain('tok-secret-999');
    await runCeremony();
    expect(container.textContent).not.toContain('tok-secret-999');
  });

  test('explains when the browser does not support WebAuthn', () => {
    vi.unstubAllGlobals();
    render(<PairDeviceView token="tok-old-browser" />);
    expect(screen.getByText(/هذا المتصفح لا يدعم/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'ابدأ الربط' })).toBeNull();
  });
});
