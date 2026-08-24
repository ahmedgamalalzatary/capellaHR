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
  invoiceId: null,
  services: [{ serviceId: 3, serviceName: 'Hair', servicePrice: '200.00', preferredEmployee: null }],
  createdAt: new Date('2026-08-24T08:00:00.000Z'),
  updatedAt: new Date('2026-08-24T08:00:00.000Z'),
};

const setup = () => {
  const create = vi.fn().mockResolvedValue(booking);
  const listDay = vi.fn().mockResolvedValue([booking]);
  const transition = vi.fn().mockResolvedValue(booking);
  const listActiveEmployees = vi.fn().mockResolvedValue([{ id: 7, name: 'Sara' }]);
  const updatePreference = vi.fn().mockResolvedValue(booking);
  const repository: BookingRepository = {
    create,
    findById: vi.fn().mockResolvedValue(booking),
    listDay,
    transition,
    countFutureForEmployee: vi.fn().mockResolvedValue(0),
    convert: vi.fn().mockResolvedValue(undefined),
    listActiveEmployees,
    updatePreference,
  };
  const service = createBookingService({
    repository,
    resolveBranchContext: vi.fn().mockResolvedValue({ branchId: 2, accountId: 3 }),
  });
  return { service, create, listDay, transition, listActiveEmployees, updatePreference };
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
    const { service, transition } = setup();
    await service.updateStatus(actor, 9, { status: 'cancelled' });
    expect(transition).toHaveBeenLastCalledWith(
      2, 9, ['booked', 'arrived'], 'cancelled', expect.any(Date),
    );
    await service.updateStatus(actor, 9, { status: 'no_show' });
    expect(transition).toHaveBeenLastCalledWith(
      2, 9, ['booked'], 'no_show', expect.any(Date),
    );
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
});
