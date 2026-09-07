/** Diary rows that can be split into overdue booked visits and everything else. */
export type DiaryBooking = {
  scheduledAt: string;
  status: string;
};

export function isOverdueBooked(booking: DiaryBooking, now: number): boolean {
  return booking.status === 'booked' && new Date(booking.scheduledAt).getTime() < now;
}

/** Overdue booked visits first, then the rest, in the original relative order. */
export function orderBookingsForDiary<T extends DiaryBooking>(bookings: T[], now: number): T[] {
  return [
    ...bookings.filter((booking) => isOverdueBooked(booking, now)),
    ...bookings.filter((booking) => !isOverdueBooked(booking, now)),
  ];
}
