import { describe, expect, it } from 'vitest';

import {
  bookingDtoSchema,
  cancelBookingServicesSchema,
  createBookingSchema,
  listBookingsQuerySchema,
  recordBookingPaymentSchema,
  rescheduleBookingSchema,
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

  it('describes per-service state, the invoice that sold it, and the booking money ledger', () => {
    const booking = bookingDtoSchema.parse({
      id: 9,
      branchId: 2,
      client: { id: 11, fullName: 'Mona', phone: '01000000000' },
      scheduledAt: '2026-08-25T07:30:00.000Z',
      status: 'arrived',
      note: null,
      money: {
        paid: '300.00',
        refunded: '0.00',
        applied: '0.00',
        held: '300.00',
        pendingValue: '600.00',
        maxPayable: '300.00',
        excess: '0.00',
      },
      services: [
        {
          serviceId: 3,
          serviceName: 'Hair colour',
          servicePrice: '200.00',
          preferredEmployee: { id: 7, name: 'Sara' },
          status: 'pending',
          invoiceId: null,
          invoiceNumber: null,
          queueStatus: null,
        },
        {
          serviceId: 4,
          serviceName: 'Manicure',
          servicePrice: null,
          preferredEmployee: null,
          status: 'sold',
          invoiceId: 41,
          invoiceNumber: 'INV-2026.08.25-10.30-000041',
          queueStatus: 'in_progress',
        },
      ],
      createdAt: '2026-08-24T08:00:00.000Z',
      updatedAt: '2026-08-25T08:00:00.000Z',
    });
    expect(booking.money?.held).toBe('300.00');
    expect(booking.services[1]?.invoiceId).toBe(41);
    expect(booking.services[1]?.queueStatus).toBe('in_progress');
    expect('invoiceId' in booking).toBe(false);
  });

  it('records an up-front payment against an open shift with a real method', () => {
    expect(recordBookingPaymentSchema.parse({
      branchId: 2,
      cashierSessionId: 13,
      method: 'cash',
      amount: '100.00',
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    })).toEqual({
      branchId: 2,
      cashierSessionId: 13,
      method: 'cash',
      amount: '100.00',
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    });
    // booking_credit is how the system spends held money, never what a cashier types.
    expect(recordBookingPaymentSchema.safeParse({
      cashierSessionId: 13,
      method: 'booking_credit',
      amount: '100.00',
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    }).success).toBe(false);
    expect(recordBookingPaymentSchema.safeParse({
      cashierSessionId: 13,
      method: 'cash',
      amount: '0.00',
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    }).success).toBe(false);
  });

  it('cancels chosen pending services and carries the mandatory refund when money is held', () => {
    expect(cancelBookingServicesSchema.parse({
      branchId: 2,
      serviceIds: [3, 4],
      refund: {
        cashierSessionId: 13,
        payments: [{ method: 'cash', amount: '150.00' }],
        operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
      },
    }).serviceIds).toEqual([3, 4]);
    expect(cancelBookingServicesSchema.safeParse({ serviceIds: [] }).success).toBe(false);
    expect(cancelBookingServicesSchema.safeParse({
      serviceIds: [3, 3],
    }).success).toBe(false);
    expect(cancelBookingServicesSchema.safeParse({
      serviceIds: [3],
      refund: {
        cashierSessionId: 13,
        payments: [{ method: 'booking_credit', amount: '150.00' }],
        operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
      },
    }).success).toBe(false);
  });

  it('reschedules a pending booking to a new date', () => {
    expect(rescheduleBookingSchema.parse({
      branchId: 2,
      scheduledAt: '2026-08-30T10:30:00+03:00',
    })).toEqual({ branchId: 2, scheduledAt: '2026-08-30T10:30:00+03:00' });
    expect(rescheduleBookingSchema.safeParse({ scheduledAt: 'not-a-date' }).success).toBe(false);
  });

  it('allows the drawer refund block only when cancelling or marking a no-show', () => {
    const refund = {
      cashierSessionId: 13,
      payments: [{ method: 'cash', amount: '100.00' }],
      operationReference: '018f47a6-7b2f-7c41-91e9-a5dd1d8e1630',
    };
    expect(updateBookingStatusSchema.safeParse({ status: 'cancelled', refund }).success).toBe(true);
    expect(updateBookingStatusSchema.safeParse({ status: 'no_show', refund }).success).toBe(true);
    expect(updateBookingStatusSchema.safeParse({ status: 'arrived', refund }).success).toBe(false);
    expect(updateBookingStatusSchema.safeParse({ status: 'booked', refund }).success).toBe(false);
  });
});
