import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({ completeDevicePairing: vi.fn() }));

vi.mock('../src/features/devices/api/devices-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  completeDevicePairing: mocks.completeDevicePairing,
}));

import { PairDeviceView } from '../src/features/devices/components/pair-device-view';

beforeEach(() => {
  window.localStorage.clear();
  mocks.completeDevicePairing.mockResolvedValue({ id: 5, status: 'active' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PairDeviceView', () => {
  test('automatically pairs the exact browser when the token link opens', async () => {
    render(<PairDeviceView token="tok-live-1" />);

    expect(await screen.findByText('تم ربط الجهاز بنجاح')).toBeDefined();
    const [token, body] = mocks.completeDevicePairing.mock.calls[0] as [string, Record<string, unknown>];
    expect(token).toBe('tok-live-1');
    expect(typeof body['installationMarker']).toBe('string');
    expect((body['installationMarker'] as string).length).toBeGreaterThanOrEqual(16);
    expect(body).not.toHaveProperty('response');
    expect(typeof body['browser']).toBe('string');
    expect(typeof body['platform']).toBe('string');
  });

  test('reuses the same installation marker across token links', async () => {
    render(<PairDeviceView token="tok-a" />);
    await waitFor(() => expect(mocks.completeDevicePairing).toHaveBeenCalledTimes(1));
    const first = (mocks.completeDevicePairing.mock.calls[0]?.[1] as Record<string, unknown>)['installationMarker'];
    cleanup();

    render(<PairDeviceView token="tok-b" />);
    await waitFor(() => expect(mocks.completeDevicePairing).toHaveBeenCalledTimes(2));
    const second = (mocks.completeDevicePairing.mock.calls[1]?.[1] as Record<string, unknown>)['installationMarker'];
    expect(second).toBe(first);
  });

  test('shows the server error and permits retrying', async () => {
    mocks.completeDevicePairing.mockRejectedValueOnce(
      new ApiError(409, { code: 'DEVICE_PAIRING_INVALID', message: 'طلب ربط الجهاز غير صالح' }),
    );
    render(<PairDeviceView token="tok-live-2" />);

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'طلب ربط الجهاز غير صالح');
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('تم ربط الجهاز بنجاح')).toBeDefined();
  });

  test('never exposes the raw pairing token on the page', async () => {
    const { container } = render(<PairDeviceView token="tok-secret-999" />);
    expect(container.textContent).not.toContain('tok-secret-999');
    await waitFor(() => expect(mocks.completeDevicePairing).toHaveBeenCalled());
    expect(container.textContent).not.toContain('tok-secret-999');
  });
});
