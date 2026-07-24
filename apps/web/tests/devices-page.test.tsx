import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';

const mocks = vi.hoisted(() => ({
  listDevices: vi.fn(),
  createPairing: vi.fn(),
  cancelPairing: vi.fn(),
  revokeDevice: vi.fn(),
  getDeviceHistory: vi.fn(),
  listEmployees: vi.fn(),
  listBranches: vi.fn(),
}));

vi.mock('../src/features/devices/api/devices-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listDevices: mocks.listDevices,
  createPairing: mocks.createPairing,
  cancelPairing: mocks.cancelPairing,
  revokeDevice: mocks.revokeDevice,
  getDeviceHistory: mocks.getDeviceHistory,
}));

vi.mock('../src/features/employees/api/employees-api', () => ({
  listEmployees: mocks.listEmployees,
}));

vi.mock('../src/features/branches/api/branches-api', () => ({
  listBranches: mocks.listBranches,
}));

import { DevicesView } from '../src/features/devices/components/devices-view';

const activeDevice = {
  id: 1,
  assignmentType: 'employee' as const,
  assignmentId: 7,
  status: 'active' as const,
  browser: 'Chrome 126',
  platform: 'Android',
  pairedAt: '2026-07-01T08:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
};

const revokedDevice = {
  ...activeDevice,
  id: 2,
  assignmentType: 'branch' as const,
  assignmentId: 3,
  status: 'revoked' as const,
  revokedAt: '2026-07-10T08:00:00.000Z',
};

const pageOf = (items: unknown[], meta: Partial<Record<string, number>> = {}) => ({
  items,
  meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...meta },
});

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DevicesView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.listDevices.mockResolvedValue(pageOf([activeDevice, revokedDevice]));
  mocks.listEmployees.mockResolvedValue(pageOf([{ id: 7, fullName: 'أحمد جمال', employeeCode: 1 }]));
  mocks.listBranches.mockResolvedValue(pageOf([{ id: 3, name: 'فرع القاهرة' }]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DevicesView', () => {
  test('loads inactive employees for existing device assignments', async () => {
    renderView();
    await waitFor(() => {
      expect(mocks.listEmployees).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, status: 'all' }),
      );
    });
  });

  test('lists devices with resolved assignment names and status badges', async () => {
    renderView();
    const employeeRow = (await screen.findByText('أحمد جمال')).closest('tr')!;
    const branchRow = (await screen.findByText('فرع القاهرة')).closest('tr')!;
    expect(within(employeeRow).getByText('نشط')).toBeDefined();
    expect(within(branchRow).getByText('ملغي')).toBeDefined();
    expect(within(employeeRow).getByText(/Chrome 126/)).toBeDefined();
  });

  test('shows an Arabic empty state when there are no devices', async () => {
    mocks.listDevices.mockResolvedValue(pageOf([]));
    renderView();
    expect(await screen.findByText('لا توجد أجهزة مسجلة بعد')).toBeDefined();
  });

  test('filters by status and assignment type', async () => {
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.change(screen.getByLabelText('تصفية حسب الحالة'), { target: { value: 'active' } });
    await waitFor(() => {
      expect(mocks.listDevices).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'active', page: 1 }),
      );
    });
    fireEvent.change(screen.getByLabelText('تصفية حسب النوع'), { target: { value: 'branch' } });
    await waitFor(() => {
      expect(mocks.listDevices).toHaveBeenLastCalledWith(
        expect.objectContaining({ assignmentType: 'branch', status: 'active', page: 1 }),
      );
    });
  });

  test('creates an employee pairing and shows the single-use link and QR code', async () => {
    mocks.createPairing.mockResolvedValue({ id: 11, pairingToken: 'tok-abc123' });
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'ربط جهاز جديد' }));

    fireEvent.change(screen.getByLabelText(/نوع التعيين/), { target: { value: 'employee' } });
    fireEvent.change(screen.getByLabelText(/^التعيين/), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء طلب الربط' }));

    await waitFor(() => expect(mocks.createPairing).toHaveBeenCalledTimes(1));
    expect(mocks.createPairing.mock.calls[0]?.[0]).toEqual({
      assignmentType: 'employee',
      assignmentId: 7,
    });

    const link = (await screen.findByLabelText('رابط الربط')) as HTMLInputElement;
    expect(link.value).toContain('/pair/tok-abc123');
    expect(screen.queryByText(/غير متاح بعد/)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('pairing-qr').innerHTML).toContain('svg'));
  });

  test('disables closing the pairing form while creation is pending', async () => {
    mocks.createPairing.mockReturnValue(new Promise(() => {}));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'ربط جهاز جديد' }));
    fireEvent.change(screen.getByLabelText(/^التعيين/), { target: { value: '7' } });

    const cancel = screen.getByRole('button', { name: 'إلغاء' }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء طلب الربط' }));
    await waitFor(() => expect(cancel.disabled).toBe(true));
  });

  test('cancels a pending pairing request', async () => {
    mocks.createPairing.mockResolvedValue({ id: 11, pairingToken: 'tok-abc123' });
    mocks.cancelPairing.mockResolvedValue(undefined);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'ربط جهاز جديد' }));
    fireEvent.change(screen.getByLabelText(/نوع التعيين/), { target: { value: 'employee' } });
    fireEvent.change(screen.getByLabelText(/^التعيين/), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء طلب الربط' }));
    await screen.findByLabelText('رابط الربط');

    fireEvent.click(screen.getByRole('button', { name: 'إلغاء طلب الربط' }));
    await waitFor(() => expect(mocks.cancelPairing).toHaveBeenCalledTimes(1));
    expect(mocks.cancelPairing.mock.calls[0]?.[0]).toBe(11);
  });

  test('revokes an active device only after confirmation', async () => {
    mocks.revokeDevice.mockResolvedValue(undefined);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء التسجيل' }));
    expect(mocks.revokeDevice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    await waitFor(() => expect(mocks.revokeDevice).toHaveBeenCalledTimes(1));
    expect(mocks.revokeDevice.mock.calls[0]?.[0]).toBe(1);
  });

  test('offers no revoke action for an already revoked device', async () => {
    renderView();
    const row = (await screen.findByText('فرع القاهرة')).closest('tr')!;
    expect(within(row).queryByRole('button', { name: 'إلغاء التسجيل' })).toBeNull();
  });

  test('surfaces the Arabic error when revocation fails', async () => {
    mocks.revokeDevice.mockRejectedValue(
      new ApiError(404, { code: 'DEVICE_NOT_FOUND', message: 'الجهاز غير موجود' }),
    );
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء التسجيل' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'الجهاز غير موجود');
  });

  test('shows the device history with Arabic event labels', async () => {
    mocks.getDeviceHistory.mockResolvedValue([
      { event: 'paired', createdAt: '2026-07-01T08:00:00.000Z' },
      { event: 'revoked', createdAt: '2026-07-10T08:00:00.000Z' },
    ]);
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(within(screen.getByText('أحمد جمال').closest('tr')!).getByRole('button', { name: 'السجل' }));
    await waitFor(() => expect(mocks.getDeviceHistory).toHaveBeenCalledTimes(1));
    expect(mocks.getDeviceHistory.mock.calls[0]?.[0]).toBe(1);
    expect(await screen.findByText('تم الربط')).toBeDefined();
    expect(screen.getByText('تم الإلغاء')).toBeDefined();
  });

  test('paginates with the next button', async () => {
    mocks.listDevices.mockResolvedValue(pageOf([activeDevice], { total: 30, totalPages: 2 }));
    renderView();
    await screen.findByText('أحمد جمال');
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    await waitFor(() => {
      const params = mocks.listDevices.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(params).toMatchObject({ page: 2 });
      expect(params).not.toHaveProperty('pageSize');
    });
  });
});
