import { describe, expect, it, vi } from 'vitest';

import {
  BookingError,
  createBookingService,
  type BookingRecord,
  type BookingRepository,
} from '../../src/modules/erp/bookings/booking-service.js';

const actor = { role: 'cashier' as const, accountId: 3, branchId: 2 };
const booking: BookingRecord = {
  id: 9,
  branchId: 2,
  client: { id: 11, fullName: 'Mona', phone: '01000000000' },
  scheduledAt: new Date('2026-08-25T07:30:00.000Z'),
  status: 'booked',
  note: null,
  money: {
    paid: '0.00', refunded: '0.00', applied: '0.00', held: '0.00',
    pendingValue: '200.00', maxPayable: '200.00', excess: '0.00',
  },
  services: [{
    serviceId: 3, serviceName: 'Hair', servicePrice: '200.00', preferredEmployee: null,
    status: 'pending' as const, invoiceId: null, invoiceNumber: null, queueStatus: null,
  }],
  createdAt: new Date('2026-08-24T08:00:00.000Z'),
  updatedAt: new Date('2026-08-24T08:00:00.000Z'),
};

const setup = () => {
  const create = vi.fn().mockResolvedValue(booking);
  const listDay = vi.fn().mockResolvedValue([booking]);
  const transition = vi.fn().mockResolvedValue(booking);
  const listActiveEmployees = vi.fn().mockResolvedValue([{ id: 7, name: 'Sara' }]);
  const updatePreference = vi.fn().mockResolvedValue(booking);
  const findById = vi.fn().mockResolvedValue(booking);
  const remove = vi.fn().mockResolvedValue(booking);
  const recordPayment = vi.fn().mockResolvedValue(booking);
  const cancelServices = vi.fn().mockResolvedValue(booking);
  const finalizeCancellation = vi.fn().mockResolvedValue(booking);
  const reschedule = vi.fn().mockResolvedValue(booking);
  const repository: BookingRepository = {
    create,
    findById,
    listDay,
    remove,
    recordPayment,
    cancelServices,
    finalizeCancellation,
    reschedule,
    transition,
    countFutureForEmployee: vi.fn().mockResolvedValue(0),
    applySale: vi.fn().mockResolvedValue(undefined),
    listActiveEmployees,
    updatePreference,
  };
  const service = createBookingService({
    repository,
    resolveBranchContext: vi.fn().mockResolvedValue({ branchId: 2, accountId: 3 }),
  });
  return { service, create, listDay, transition, listActiveEmployees, updatePreference, findById, remove, recordPayment, cancelServices, finalizeCancellation, reschedule };
};

describe('ERP booking service', () => {
  it('creates a branch-scoped booking under the acting account', async () => {
    const { service, create } = setup();
    await expect(service.create(actor, {
      clientId: 11,
      scheduledAt: '2026-08-25T10:30:00+03:00',
      services: [{ serviceId: 3 }],
    })).resolves.toEqual(booking);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      branchId: 2,
      actingAccountId: 3,
      clientId: 11,
      scheduledAt: new Date('2026-08-25T07:30:00.000Z'),
      note: null,
    }));
  });

  it('uses explicit conditional transitions including return-to-booked', async () => {
    const { service, transition } = setup();
    await service.updateStatus(actor, 9, { status: 'arrived' });
    expect(transition).toHaveBeenLastCalledWith(
      2, 9, ['booked'], 'arrived', expect.any(Date),
    );
    await service.updateStatus(actor, 9, { status: 'booked' });
    expect(transition).toHaveBeenLastCalledWith(
      2, 9, ['arrived'], 'booked', expect.any(Date),
    );
  });

  it('allows cancellation after booking or arrival and no-show only before arrival', async () => {
    const { service, finalizeCancellation } = setup();
    await service.updateStatus(actor, 9, { status: 'cancelled' });
    expect(finalizeCancellation).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9, branchId: 2, status: 'cancelled',
    }));
    await service.updateStatus(actor, 9, { status: 'no_show' });
    expect(finalizeCancellation).toHaveBeenLastCalledWith(expect.objectContaining({
      bookingId: 9, branchId: 2, status: 'no_show',
    }));
  });

  it('reports when another staff member won the transition', async () => {
    const { service, transition } = setup();
    transition.mockResolvedValue(null);
    await expect(service.updateStatus(actor, 9, { status: 'arrived' }))
      .rejects.toEqual(new BookingError('BOOKING_ALREADY_HANDLED'));
  });

  it('lists exactly the requested Cairo diary date in the acting branch', async () => {
    const { service, listDay } = setup();
    await service.listDay(actor, { date: '2026-08-25' });
    expect(listDay).toHaveBeenCalledWith(2, '2026-08-25');
  });

  it('lists active preferred-employee choices in the acting branch', async () => {
    const { service, listActiveEmployees } = setup();
    await expect(service.listEmployeeOptions(actor)).resolves.toEqual([{ id: 7, name: 'Sara' }]);
    expect(listActiveEmployees).toHaveBeenCalledWith(2);
  });

  it('changes a preferred employee only through the branch-scoped repository', async () => {
    const { service, updatePreference } = setup();
    await service.updatePreference(actor, 9, 3, { preferredEmployeeId: 7 });
    expect(updatePreference).toHaveBeenCalledWith(2, 9, 3, 7, expect.any(Date));
  });

  it('hard-deletes a booking without payment (no linked invoice)', async () => {
    const { service, remove } = setup();
    await expect(service.remove(actor, 9)).resolves.toMatchObject({ id: 9 });
    expect(remove).toHaveBeenCalledWith(2, 9);
  });

  it('reports a missing booking as not found', async () => {
    const { service, findById } = setup();
    findById.mockResolvedValue(null);
    await expect(service.remove(actor, 999)).rejects.toEqual(
      new BookingError('BOOKING_NOT_FOUND'),
    );
  });

  it('refuses to hard-delete a converted booking linked to an invoice', async () => {
    const { service, findById } = setup();
    findById.mockResolvedValue({ ...booking, status: 'converted', invoiceId: 41 });
    await expect(service.remove(actor, 9)).rejects.toEqual(
      new BookingError('BOOKING_ALREADY_HANDLED'),
    );
  });
});

describe('ERP booking payments service', () => {
  it('records an up-front payment through the repository with the acting account', async () => {
    const { service, recordPayment } = setup();
    await service.recordPayment(actor, 9, {
      cashierSessionId: 13,
      method: 'cash',
      amount: '100.00',
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    });
    expect(recordPayment).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9,
      branchId: 2,
      actorAccountId: 3,
      actorRole: 'cashier',
      cashierSessionId: 13,
      method: 'cash',
      amount: '100.00',
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    }));
  });
});

describe('ERP booking leftovers service', () => {
  it('cancels chosen services through the branch-scoped repository with the refund block', async () => {
    const { service, cancelServices } = setup();
    const refund = {
      cashierSessionId: 13,
      payments: [{ method: 'cash' as const, amount: '50.00' }],
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    };
    await service.cancelServices(actor, 9, { serviceIds: [3], refund });
    expect(cancelServices).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9, branchId: 2, serviceIds: [3], actorAccountId: 3, actorRole: 'cashier', refund,
    }));
  });

  it('routes cancelling and no-show through the finalize path with an optional refund', async () => {
    const { service, finalizeCancellation } = setup();
    await service.updateStatus(actor, 9, { status: 'cancelled' });
    expect(finalizeCancellation).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9, branchId: 2, status: 'cancelled', actorRole: 'cashier',
    }));
    const refund = {
      cashierSessionId: 13,
      payments: [{ method: 'cash' as const, amount: '100.00' }],
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    };
    await service.updateStatus(actor, 9, { status: 'no_show', refund });
    expect(finalizeCancellation).toHaveBeenLastCalledWith(expect.objectContaining({
      bookingId: 9, status: 'no_show', refund,
    }));
  });

  it('reschedules through the branch-scoped repository', async () => {
    const { service, reschedule } = setup();
    await service.reschedule(actor, 9, { scheduledAt: '2026-08-30T10:30:00+03:00' });
    expect(reschedule).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 9, branchId: 2, scheduledAt: new Date('2026-08-30T07:30:00.000Z'),
    }));
  });
});
