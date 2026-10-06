import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  updateStatus: vi.fn(),
  push: vi.fn(),
  listBranches: vi.fn(),
  currentSession: vi.fn(),
  recordPayment: vi.fn(),
  cancelServices: vi.fn(),
  reschedule: vi.fn(),
  session: { data: { actor: { type: 'cashier', accountId: 3, branchId: 2 } }, isPending: false, isError: false, refetch: vi.fn() } as any,
}));

vi.mock('../src/features/auth', () => ({
  useSession: () => mocks.session,
}));
vi.mock('../src/features/cashier-sessions', () => ({
  listCashierSessionBranches: mocks.listBranches,
  getCurrentCashierSession: mocks.currentSession,
  cashierSessionQueryKeys: {
    all: ['cashier-sessions'],
    current: (branchId?: number) => ['cashier-sessions', 'current', branchId ?? 'cashier'],
  },
}));
vi.mock('../src/features/bookings/api/bookings-api', () => ({
  listBookings: mocks.list,
  updateBookingStatus: mocks.updateStatus,
  createBooking: vi.fn(),
  listBookingEmployeeOptions: vi.fn().mockResolvedValue([]),
  updateBookingServicePreference: vi.fn(),
  recordBookingPayment: mocks.recordPayment,
  cancelBookingServices: mocks.cancelServices,
  rescheduleBooking: mocks.reschedule,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { BookingsView } from '../src/features/bookings/components/bookings-view';

const booking = {
  id: 9,
  branchId: 2,
  client: { id: 11, fullName: 'منى أحمد', phone: '01000000000' },
  scheduledAt: '2026-08-25T07:30:00.000Z',
  status: 'booked',
  note: null,
  money: {
    paid: '0.00', refunded: '0.00', applied: '0.00', held: '0.00',
    pendingValue: '200.00', maxPayable: '200.00', excess: '0.00',
  },
  services: [{
    serviceId: 3,
    serviceName: 'صبغة شعر',
    servicePrice: '200.00',
    preferredEmployee: { id: 7, name: 'سارة' },
    status: 'pending',
    invoiceId: null,
    invoiceNumber: null,
    queueStatus: null,
  }],
  createdAt: '2026-08-24T08:00:00.000Z',
  updatedAt: '2026-08-24T08:00:00.000Z',
};

const renderView = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BookingsView initialDate="2026-08-25" />
  </QueryClientProvider>,
);

describe('appointment book', () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.list.mockReset().mockResolvedValue([booking]);
    mocks.updateStatus.mockReset().mockResolvedValue({ ...booking, status: 'arrived' });
    mocks.listBranches.mockReset().mockResolvedValue({
      items: [{ id: 2, name: 'الفرع الرئيسي' }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    mocks.push.mockReset();
    mocks.currentSession.mockReset().mockResolvedValue({ id: 5 });
    mocks.recordPayment.mockReset().mockResolvedValue(booking);
    mocks.cancelServices.mockReset().mockResolvedValue(booking);
    mocks.reschedule.mockReset().mockResolvedValue(booking);
    mocks.session = { data: { actor: { type: 'cashier', accountId: 3, branchId: 2 } }, isPending: false, isError: false, refetch: vi.fn() };
  });

  it('shows one day in time order with services and preferred employee', async () => {
    renderView();
    expect(await screen.findByText('منى أحمد')).toBeDefined();
    expect(screen.getAllByText('صبغة شعر').length).toBeGreaterThan(0);
    expect(screen.getByText(/سارة/)).toBeDefined();
    expect(mocks.list).toHaveBeenCalledWith({ date: '2026-08-25' });
  });

  it('marks arrival in place and offers an explicit start-sale action', async () => {
    mocks.updateStatus.mockImplementation(async () => {
      mocks.list.mockResolvedValue([{ ...booking, status: 'arrived' }]);
      return { ...booking, status: 'arrived' };
    });
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'وصل العميل' }));
    await waitFor(() => expect(mocks.updateStatus).toHaveBeenCalledWith(9, { status: 'arrived' }));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(await screen.findByRole('link', { name: 'بدء البيع' })).toHaveProperty(
      'href',
      expect.stringContaining('/sales?bookingId=9'),
    );
  });

  it('asks before cancelling an appointment', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'إلغاء' }));
    expect(mocks.updateStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    await waitFor(() => expect(mocks.updateStatus).toHaveBeenCalledWith(9, { status: 'cancelled' }));
  });

  it('jumps the diary to today', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'اليوم التالي' }));
    fireEvent.click(await screen.findByRole('button', { name: /^اليوم$/ }));
    const cairoToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({ date: cairoToday }));
  });

  it('moves between diary days', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'اليوم التالي' }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({ date: '2026-08-26' }));
  });

  it('jumps to a picked calendar day', async () => {
    renderView();
    const picker = await screen.findByLabelText('اختر اليوم');
    expect(picker).toHaveProperty('value', '2026-08-25');

    fireEvent.change(picker, { target: { value: '2026-09-02' } });

    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({ date: '2026-09-02' }));
  });

  it('disables the admin branch selector while branches load', async () => {
    mocks.session = { data: { actor: { type: 'admin', accountId: 1 } }, isPending: false, isError: false, refetch: vi.fn() };
    mocks.listBranches.mockReturnValue(new Promise(() => undefined));
    renderView();

    expect(await screen.findByLabelText('الفرع')).toHaveProperty('disabled', true);
  });

  it('retries branch loading when it fails', async () => {
    mocks.session = { data: { actor: { type: 'admin', accountId: 1 } }, isPending: false, isError: false, refetch: vi.fn() };
    mocks.listBranches.mockRejectedValueOnce(new Error('network'));
    renderView();

    expect((await screen.findByText('تعذر تحميل الفروع.')).textContent).toBeDefined();
    mocks.listBranches.mockResolvedValueOnce({
      items: [{ id: 2, name: 'الفرع الرئيسي' }],
      meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByRole('option', { name: 'الفرع الرئيسي' })).toBeDefined();
  });

  it('shows a retry when session verification fails', () => {
    const refetch = vi.fn();
    mocks.session = { data: undefined, isPending: false, isError: true, refetch };
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  const paidBooking = {
    ...booking,
    status: 'arrived',
    money: {
      paid: '300.00', refunded: '0.00', applied: '0.00', held: '300.00',
      pendingValue: '350.00', maxPayable: '50.00', excess: '0.00',
    },
    services: [
      { ...booking.services[0]!, serviceId: 3, servicePrice: '200.00' },
      { ...booking.services[0]!, serviceId: 4, serviceName: 'قص شعر', servicePrice: '150.00', preferredEmployee: null },
    ],
  };

  it('shows each service state and the booking money', async () => {
    mocks.list.mockResolvedValue([{
      ...paidBooking,
      money: { ...paidBooking.money, applied: '200.00', held: '100.00', pendingValue: '0.00' },
      services: [
        { ...paidBooking.services[0]!, status: 'sold', invoiceId: 40, invoiceNumber: 'INV-40', queueStatus: 'in_progress' },
        { ...paidBooking.services[1]!, status: 'cancelled' },
      ],
    }]);
    renderView();
    expect(await screen.findByText('قيد التنفيذ')).toBeDefined();
    expect(screen.getByText('ملغاة')).toBeDefined();
    expect(screen.getByText(/INV-40/)).toBeDefined();
    const strip = screen.getByRole('list', { name: 'أموال الحجز' });
    expect(strip.textContent).toContain('مدفوع مقدم');
    expect(strip.textContent).toContain('300.00');
    expect(strip.textContent).toContain('المتبقي لدينا');
    expect(strip.textContent).toContain('100.00');
  });

  it('takes an up-front payment into the open shift, never above the limit', async () => {
    mocks.list.mockResolvedValue([paidBooking]);
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'دفع مقدم' }));
    const amount = screen.getByLabelText('مبلغ الدفع المقدم');
    fireEvent.change(amount, { target: { value: '60' } });
    expect(screen.getByRole('button', { name: 'تسجيل الدفع' })).toHaveProperty('disabled', true);
    fireEvent.change(amount, { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('طريقة الدفع المقدم'), { target: { value: 'visa' } });
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الدفع' }));
    await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledWith(9, {
      cashierSessionId: 5, method: 'visa', amount: '50.00',
      operationReference: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }));
  });

  it('cannot take an up-front payment without an open shift', async () => {
    mocks.list.mockResolvedValue([paidBooking]);
    mocks.currentSession.mockResolvedValue(null);
    renderView();
    expect(await screen.findByRole('button', { name: 'دفع مقدم' })).toHaveProperty('disabled', true);
  });

  it('tells the cashier when the open shift could not be loaded and lets them retry', async () => {
    mocks.list.mockResolvedValue([paidBooking]);
    mocks.currentSession.mockRejectedValueOnce(new Error('network'));
    renderView();
    expect(await screen.findByText('تعذر التحقق من الوردية المفتوحة.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة تحميل الوردية' }));
    await waitFor(() => expect(mocks.currentSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'دفع مقدم' })).toHaveProperty('disabled', false));
  });

  it('hands the held money back from the drawer when the booking is cancelled', async () => {
    mocks.list.mockResolvedValue([paidBooking]);
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'إلغاء' }));
    expect(await screen.findByText(/سيتم رد 300.00 ج.م للعميل من الدرج/)).toBeDefined();
    fireEvent.change(screen.getByLabelText('رد نقدي'), { target: { value: '200' } });
    expect(screen.getByRole('button', { name: 'تأكيد الإلغاء' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('رد فيزا'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }));
    await waitFor(() => expect(mocks.updateStatus).toHaveBeenCalledWith(9, {
      status: 'cancelled',
      refund: {
        cashierSessionId: 5,
        payments: [{ method: 'cash', amount: '200.00' }, { method: 'visa', amount: '100.00' }],
        operationReference: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    }));
  });

  it('cancels one waiting service and returns only what the rest no longer covers', async () => {
    mocks.list.mockResolvedValue([paidBooking]);
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'إلغاء خدمة صبغة شعر' }));
    expect(await screen.findByText(/سيتم رد 150.00 ج.م للعميل من الدرج/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد إلغاء الخدمة' }));
    await waitFor(() => expect(mocks.cancelServices).toHaveBeenCalledWith(9, {
      serviceIds: [3],
      refund: {
        cashierSessionId: 5,
        payments: [{ method: 'cash', amount: '150.00' }],
        operationReference: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    }));
  });

  it('cancels a waiting service with nothing to return after a plain confirmation', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'إلغاء خدمة صبغة شعر' }));
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد إلغاء الخدمة' }));
    await waitFor(() => expect(mocks.cancelServices).toHaveBeenCalledWith(9, { serviceIds: [3] }));
  });

  it('moves the appointment to a new date and time', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'تغيير الموعد' }));
    fireEvent.change(screen.getByLabelText('الموعد الجديد'), { target: { value: '2026-08-30T14:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الموعد' }));
    await waitFor(() => expect(mocks.reschedule).toHaveBeenCalledWith(9, {
      scheduledAt: '2026-08-30T11:00:00.000Z',
    }));
  });
});
