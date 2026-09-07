import { describe, expect, test } from 'vitest';

import { orderBookingsForDiary } from '../src/features/bookings/order-bookings';

const booking = (id: number, scheduledAt: string, status: 'booked' | 'arrived' = 'booked') => ({
  id,
  scheduledAt,
  status,
});

describe('orderBookingsForDiary', () => {
  test('lists overdue booked visits before the rest, using the given clock', () => {
    const now = Date.parse('2026-09-07T12:00:00.000Z');
    const overdue = booking(1, '2026-09-07T09:00:00.000Z');
    const upcoming = booking(2, '2026-09-07T15:00:00.000Z');
    const arrived = booking(3, '2026-09-07T08:00:00.000Z', 'arrived');

    const ordered = orderBookingsForDiary([upcoming, overdue, arrived], now);

    expect(ordered.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(ordered.filter((item) => item.status === 'booked'
      && Date.parse(item.scheduledAt) < now)).toHaveLength(1);
  });
});
