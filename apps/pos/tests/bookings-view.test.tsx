import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  updateStatus: vi.fn(),
  push: vi.fn(),
  session: { data: { actor: { type: 'cashier', accountId: 3, branchId: 2 } }, isPending: false, isError: false, refetch: vi.fn() } as any,
}));

vi.mock('../src/features/auth', () => ({
  useSession: () => mocks.session,
}));
vi.mock('../src/features/bookings/api/bookings-api', () => ({
  listBookings: mocks.list,
  updateBookingStatus: mocks.updateStatus,
  createBooking: vi.fn(),
  listBookingEmployeeOptions: vi.fn().mockResolvedValue([]),
  updateBookingServicePreference: vi.fn(),
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
  invoiceId: null,
  services: [{
    serviceId: 3,
    serviceName: 'صبغة شعر',
    servicePrice: '200.00',
    preferredEmployee: { id: 7, name: 'سارة' },
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
    mocks.push.mockReset();
    mocks.session = { data: { actor: { type: 'cashier', accountId: 3, branchId: 2 } }, isPending: false, isError: false, refetch: vi.fn() };
  });

  it('shows one day in time order with services and preferred employee', async () => {
    renderView();
    expect(await screen.findByText('منى أحمد')).toBeDefined();
    expect(screen.getAllByText('صبغة شعر').length).toBeGreaterThan(0);
    expect(screen.getByText(/سارة/)).toBeDefined();
    expect(mocks.list).toHaveBeenCalledWith({ date: '2026-08-25' });
  });

  it('claims arrival before opening the prefilled sale', async () => {
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'وصل العميل' }));
    await waitFor(() => expect(mocks.updateStatus).toHaveBeenCalledWith(9, { status: 'arrived' }));
    expect(mocks.push).toHaveBeenCalledWith('/sales?bookingId=9');
  });

  it('moves between diary days', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'اليوم التالي' }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({ date: '2026-08-26' }));
  });

  it('shows a retry when session verification fails', () => {
    const refetch = vi.fn();
    mocks.session = { data: undefined, isPending: false, isError: true, refetch };
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
