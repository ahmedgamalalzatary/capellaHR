import { describe, expect, it } from 'vitest';

import {
  bookingCheckout,
  excessAfterCancelling,
  refundPaymentsFor,
} from '../src/features/bookings/booking-money';

const booking = (held: string, pendingValue: string, services: Array<{
  serviceId: number; servicePrice: string | null; status: 'pending' | 'sold' | 'cancelled';
}>) => ({
  money: {
    paid: held, refunded: '0.00', applied: '0.00', held, pendingValue,
    maxPayable: '0.00', excess: '0.00',
  },
  services,
});

describe('booking money on the till', () => {
  it('returns only the held money the remaining services no longer cover when some are cancelled', () => {
    const value = booking('300.00', '350.00', [
      { serviceId: 1, servicePrice: '200.00', status: 'pending' },
      { serviceId: 2, servicePrice: '150.00', status: 'pending' },
    ]);
    expect(excessAfterCancelling(value, [2])).toBe('100.00');
    expect(excessAfterCancelling(value, [1])).toBe('150.00');
    expect(excessAfterCancelling(value, [1, 2])).toBe('300.00');
  });

  it('owes nothing back when the remaining services still cover the held money', () => {
    expect(excessAfterCancelling(booking('100.00', '350.00', [
      { serviceId: 1, servicePrice: '200.00', status: 'pending' },
      { serviceId: 2, servicePrice: '150.00', status: 'pending' },
    ]), [2])).toBe('0.00');
  });

  it('counts an open-price service as zero toward what remains', () => {
    expect(excessAfterCancelling(booking('100.00', '100.00', [
      { serviceId: 1, servicePrice: '100.00', status: 'pending' },
      { serviceId: 2, servicePrice: null, status: 'pending' },
    ]), [1])).toBe('100.00');
  });

  it('uses held money first at checkout and hands back only what the leftovers do not need', () => {
    const value = booking('350.00', '350.00', [
      { serviceId: 1, servicePrice: '200.00', status: 'pending' },
      { serviceId: 2, servicePrice: '150.00', status: 'pending' },
    ]);
    expect(bookingCheckout(value, '100.00', [1])).toEqual({ credit: '100.00', excess: '100.00' });
    expect(bookingCheckout(value, '200.00', [1])).toEqual({ credit: '200.00', excess: '0.00' });
    expect(bookingCheckout(value, '500.00', [1, 2])).toEqual({ credit: '350.00', excess: '0.00' });
    expect(bookingCheckout(value, '300.00', [1, 2])).toEqual({ credit: '300.00', excess: '50.00' });
  });

  it('accepts a refund split only when it adds up to the amount owed', () => {
    expect(refundPaymentsFor({ cash: '60', visa: '40.00', instapay: '', vodafone_cash: '' }, '100.00'))
      .toEqual([{ method: 'cash', amount: '60.00' }, { method: 'visa', amount: '40.00' }]);
    expect(refundPaymentsFor({ cash: '60', visa: '', instapay: '', vodafone_cash: '' }, '100.00')).toBeNull();
    expect(refundPaymentsFor({ cash: 'x', visa: '', instapay: '', vodafone_cash: '' }, '100.00')).toBeNull();
  });
});
