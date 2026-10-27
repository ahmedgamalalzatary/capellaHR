import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), clients: vi.fn(), services: vi.fn(), employees: vi.fn() }));
vi.mock('../src/features/bookings/api/bookings-api', async (original) => ({ ...(await original<object>()), updateBooking: mocks.update, createBooking: mocks.create, listBookingEmployeeOptions: mocks.employees }));
vi.mock('../src/features/clients/api/clients-api', async (original) => ({ ...(await original<object>()), listClients: mocks.clients }));
vi.mock('../src/features/catalog/api/catalog-api', async (original) => ({ ...(await original<object>()), listServices: mocks.services }));

import { BookingForm } from '../src/features/bookings/components/booking-form';
import { ApiError } from '../src/lib/api/client';

const client = { id: 11, branchId: 2, fullName: 'منى', phone: '01000000000', createdAt: '', updatedAt: '' };
const service = { id: 3, branchId: 2, categoryId: 1, categoryName: 'الشعر', categoryIsActive: true, name: 'صبغة', price: '200.00', description: null, commissionPercent: '10.00', isActive: true, createdAt: '', updatedAt: '' };
const meta = { page: 1, pageSize: 50, total: 1, totalPages: 1 };

const prepare = async (cashierSessionId: number | null = 13) => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <BookingForm branchId={2} cashierSessionId={cashierSessionId} onClose={() => undefined} onSaved={() => undefined} />
  </QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('ابحث عن العميل برقم الهاتف أو الاسم'), { target: { value: 'منى' } });
  fireEvent.click(await screen.findByRole('button', { name: /منى.*01000000000/ }));
  fireEvent.click(await screen.findByRole('button', { name: /صبغة.*200.00/ }));
  fireEvent.change(screen.getByLabelText('التاريخ والوقت'), { target: { value: '2026-11-25T10:30' } });
};

describe('booking creation payment', () => {
  beforeEach(() => {
    mocks.clients.mockReset().mockResolvedValue({ items: [client], meta });
    mocks.services.mockReset().mockResolvedValue({ items: [service], meta });
    mocks.employees.mockReset().mockResolvedValue([]);
    mocks.create.mockReset().mockRejectedValue(new Error('Connection lost'));
  });
  afterEach(cleanup);

  it('edits a future booking and requires returning the original advance before changing client', async () => {
    const booking = { id: 9, branchId: 2, client, scheduledAt: '2026-11-25T08:30:00.000Z', status: 'booked' as const, note: 'Original',
      money: { paid: '100.00', held: '100.00', refunded: '0.00', applied: '0.00', pendingValue: '200.00', maxPayable: '100.00', excess: '0.00' },
      services: [{ serviceId: service.id, serviceName: service.name, servicePrice: service.price, preferredEmployee: null, status: 'pending' as const, invoiceId: null, invoiceNumber: null, queueStatus: null }],
      createdAt: '2026-10-20T08:00:00.000Z', updatedAt: '2026-10-20T08:00:00.000Z' };
    mocks.update.mockReset().mockRejectedValueOnce(new ApiError(409, { code: 'BOOKING_REFUND_REQUIRED', message: 'Return advance', amount: '100.00' })).mockResolvedValue(booking);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BookingForm booking={booking} branchId={2} cashierSessionId={13} onClose={() => undefined} onSaved={() => undefined} /></QueryClientProvider>);
    expect(screen.getByLabelText('ملاحظة')).toHaveProperty('value', 'Original');
    mocks.clients.mockResolvedValue({ items: [{ ...client, id: 12, fullName: 'سارة' }], meta });
    fireEvent.click(screen.getByRole('button', { name: 'تغيير العميل' }));
    fireEvent.change(screen.getByLabelText('ابحث عن العميل برقم الهاتف أو الاسم'), { target: { value: 'سارة' } });
    fireEvent.click(await screen.findByRole('button', { name: /سارة.*01000000000/ }));
    fireEvent.change(screen.getByLabelText('ملاحظة'), { target: { value: 'Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديلات' }));
    await screen.findByRole('button', { name: 'نعم، أعدت المال — حفظ التعديلات' });
    expect(mocks.update).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'لا، لم أعد المال' }));
    expect(mocks.update).toHaveBeenCalledOnce();
    mocks.update.mockRejectedValueOnce(new ApiError(409, { code: 'BOOKING_REFUND_REQUIRED', message: 'Return advance', amount: '100.00' }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديلات' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'نعم، أعدت المال — حفظ التعديلات' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(3));
    expect(mocks.update.mock.calls[2]).toEqual([9, expect.objectContaining({ clientId: 12, note: 'Updated', refund: { cashierSessionId: 13, payments: [{ method: 'cash', amount: '100.00' }], operationReference: expect.any(String) } })]);
  });

  it.each(['100', '200'])('sends a %s payment with the booking and keeps its reference on retry', async (amount) => {
    await prepare();
    fireEvent.change(screen.getByLabelText('مبلغ الدفع المقدم'), { target: { value: amount } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الحجز' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ branchId: 2, clientId: 11, initialPayment: { cashierSessionId: 13, method: 'cash', amount: `${amount}.00` }, operationReference: expect.any(String) });
    const reference = mocks.create.mock.calls[0]![0].operationReference;
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الحجز' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![0].operationReference).toBe(reference);
  });

  it('blocks overpayment and payment without an open shift but allows an unpaid booking', async () => {
    await prepare(null);
    fireEvent.change(screen.getByLabelText('مبلغ الدفع المقدم'), { target: { value: '201' } });
    expect(screen.getByRole('button', { name: 'حفظ الحجز' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('مبلغ الدفع المقدم'), { target: { value: '100' } });
    expect(screen.getByRole('button', { name: 'حفظ الحجز' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('مبلغ الدفع المقدم'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الحجز' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0]![0]).not.toHaveProperty('initialPayment');
  });
});
