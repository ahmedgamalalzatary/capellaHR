import { describe, expect, it } from 'vitest';

import {
  bookingDtoSchema,
  createBookingSchema,
  listBookingsQuerySchema,
  updateBookingStatusSchema,
  updateBookingServicePreferenceSchema,
} from '../../../../src/modules/erp/bookings/index.js';

describe('booking contracts', () => {
  it('accepts a staff booking with several services and optional preferences', () => {
    expect(createBookingSchema.parse({
      branchId: 2,
      clientId: 11,
      scheduledAt: '2026-08-25T10:30:00+03:00',
      note: 'First visit',
      services: [
        { serviceId: 3, preferredEmployeeId: 7 },
        { serviceId: 4 },
      ],
    })).toEqual({
      branchId: 2,
      clientId: 11,
      scheduledAt: '2026-08-25T10:30:00+03:00',
      note: 'First visit',
      services: [
        { serviceId: 3, preferredEmployeeId: 7 },
        { serviceId: 4 },
      ],
    });
  });

  it('requires at least one service and rejects the same service twice', () => {
    expect(createBookingSchema.safeParse({
      clientId: 11,
      scheduledAt: '2026-08-25T10:30:00+03:00',
      services: [],
    }).success).toBe(false);
    expect(createBookingSchema.safeParse({
      clientId: 11,
      scheduledAt: '2026-08-25T10:30:00+03:00',
      services: [{ serviceId: 3 }, { serviceId: 3 }],
    }).success).toBe(false);
  });

  it('parses a one-day diary query', () => {
    expect(listBookingsQuerySchema.parse({ date: '2026-08-25', branchId: '2' }))
      .toEqual({ date: '2026-08-25', branchId: 2 });
  });

  it('rejects impossible calendar dates before querying the diary', () => {
    expect(listBookingsQuerySchema.safeParse({ date: '2026-02-30' }).success).toBe(false);
  });

  it('allows only explicit staff status actions', () => {
    for (const status of ['arrived', 'booked', 'cancelled', 'no_show'] as const) {
      expect(updateBookingStatusSchema.parse({ status })).toEqual({ status });
    }
    expect(updateBookingStatusSchema.safeParse({ status: 'converted' }).success).toBe(false);
  });

  it('allows changing or clearing a preferred employee', () => {
    expect(updateBookingServicePreferenceSchema.parse({ preferredEmployeeId: 7 }))
      .toEqual({ preferredEmployeeId: 7 });
    expect(updateBookingServicePreferenceSchema.parse({ preferredEmployeeId: null }))
      .toEqual({ preferredEmployeeId: null });
  });

  it('describes the booking handover and converted invoice', () => {
    const booking = bookingDtoSchema.parse({
      id: 9,
      branchId: 2,
      client: { id: 11, fullName: 'Mona', phone: '01000000000' },
      scheduledAt: '2026-08-25T07:30:00.000Z',
      status: 'converted',
      note: null,
      invoiceId: 41,
      services: [{
        serviceId: 3,
        serviceName: 'Hair colour',
        servicePrice: '200.00',
        preferredEmployee: { id: 7, name: 'Sara' },
      }],
      createdAt: '2026-08-24T08:00:00.000Z',
      updatedAt: '2026-08-25T08:00:00.000Z',
    });
    expect(booking.invoiceId).toBe(41);
    expect(booking.services[0]?.servicePrice).toBe('200.00');
  });
});
