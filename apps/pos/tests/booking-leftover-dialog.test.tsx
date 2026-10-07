import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getBooking: vi.fn() }));

vi.mock('../src/features/bookings/api/bookings-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBooking: mocks.getBooking,
}));

import { BookingLeftoverDialog } from '../src/features/bookings/components/booking-leftover-dialog';
import { bookingQueryKeys } from '../src/features/bookings/query-keys';

const service = (serviceId: number, serviceName: string, status: 'pending' | 'sold') => ({
  serviceId, serviceName, servicePrice: '100.00', preferredEmployee: null,
  status, invoiceId: status === 'sold' ? 3 : null, invoiceNumber: status === 'sold' ? 'INV-3' : null,
  queueStatus: status === 'sold' ? 'pending' as const : null,
});

const booking = (services: ReturnType<typeof service>[]) => ({
  id: 22, branchId: 2,
  client: { id: 5, fullName: 'منى أحمد', phone: '01012345678' },
  scheduledAt: '2026-08-25T07:30:00.000Z', status: 'arrived' as const, note: null,
  money: {
    paid: '200.00', refunded: '0.00', applied: '100.00', held: '100.00',
    pendingValue: '100.00', maxPayable: '0.00', excess: '0.00',
  },
  services, createdAt: '', updatedAt: '',
});

const beforeSale = booking([service(21, 'صبغة شعر', 'pending'), service(23, 'قص شعر', 'pending')]);
const afterSale = booking([service(21, 'صبغة شعر', 'sold'), service(23, 'قص شعر', 'pending')]);

const renderDialog = (client: QueryClient) => render(
  <QueryClientProvider client={client}>
    <BookingLeftoverDialog bookingId={22} cashierSessionId={13} />
  </QueryClientProvider>,
);

describe('leftover services after a booking sale', () => {
  afterEach(cleanup);
  beforeEach(() => { mocks.getBooking.mockReset().mockResolvedValue(afterSale); });

  it('never offers the choice on the booking as it was before the sale', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(bookingQueryKeys.detail(22), beforeSale);
    let release!: (value: unknown) => void;
    mocks.getBooking.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    renderDialog(client);
    await act(() => client.invalidateQueries({ queryKey: bookingQueryKeys.all, refetchType: 'none' }));
    // The stale booking still names the services just sold, so the choice waits:
    // what blocks the counter meanwhile must not repeat them.
    const waiting = screen.getByRole('dialog', { name: 'خدمات الحجز المتبقية' });
    expect(waiting.textContent).not.toContain('صبغة شعر');
    await act(async () => { release(afterSale); });
    const dialog = await screen.findByRole('dialog', { name: 'خدمات الحجز المتبقية' });
    expect(dialog.textContent).toContain('قص شعر');
    expect(dialog.textContent).not.toContain('صبغة شعر');
  });

  it('holds the counter while the booking reloads so the choice cannot be skipped', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release!: (value: unknown) => void;
    mocks.getBooking.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    renderDialog(client);
    // Nothing about the sale may be reachable until the leftovers are known.
    const waiting = await screen.findByRole('dialog', { name: 'خدمات الحجز المتبقية' });
    expect(screen.queryByRole('button', { name: 'إبقاء في الموعد الأصلي' })).toBeNull();
    expect(waiting.textContent).toContain('جارٍ تحميل بيانات الحجز');
    await act(async () => { release(afterSale); });
    expect(await screen.findByRole('button', { name: 'إبقاء في الموعد الأصلي' })).toBeTruthy();
  });

  it('reports a failed load and lets the cashier try again', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.getBooking.mockReturnValueOnce(Promise.reject(new Error('offline')));
    renderDialog(client);
    expect((await screen.findByRole('alert')).textContent).toContain('تعذر تحميل بيانات الحجز');
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByRole('button', { name: 'إبقاء في الموعد الأصلي' })).toBeTruthy();
  });

  it('keeps the refund the cashier is typing through a background reload', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDialog(client);
    fireEvent.click(await screen.findByRole('button', { name: 'إلغاء الخدمات المتبقية' }));
    fireEvent.change(await screen.findByLabelText('رد نقدي'), { target: { value: '60' } });
    let release!: (value: unknown) => void;
    mocks.getBooking.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    await act(async () => { void client.invalidateQueries({ queryKey: bookingQueryKeys.all }); });
    await waitFor(() => expect(mocks.getBooking).toHaveBeenCalledTimes(2));
    // While the reload is still running the dialog stays, with what was typed.
    expect((screen.getByLabelText('رد نقدي') as HTMLInputElement).value).toBe('60');
    await act(async () => { release(afterSale); });
    expect((screen.getByLabelText('رد نقدي') as HTMLInputElement).value).toBe('60');
  });
});
