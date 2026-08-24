import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookingTicket } from '../src/features/bookings/components/booking-ticket';

describe('booking ticket', () => {
  it('prints the appointment facts and a scannable booking code', () => {
    render(<BookingTicket booking={{
      id: 9, branchId: 2,
      client: { id: 11, fullName: 'منى', phone: '01000000000' },
      scheduledAt: '2026-08-25T07:30:00.000Z', status: 'booked', note: null, invoiceId: null,
      services: [{ serviceId: 3, serviceName: 'صبغة', servicePrice: '200.00', preferredEmployee: null }],
      createdAt: '2026-08-24T08:00:00.000Z', updatedAt: '2026-08-24T08:00:00.000Z',
    }} />);
    expect(screen.getByText('منى')).toBeDefined();
    expect(screen.getByText('صبغة')).toBeDefined();
    expect(screen.getByRole('img', { name: 'BOOK-9' })).toBeDefined();
  });
});
