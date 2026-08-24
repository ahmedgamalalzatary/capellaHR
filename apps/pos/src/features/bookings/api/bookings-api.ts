import type {
  BookingDto,
  CreateBookingInput,
  ListBookingsQuery,
  UpdateBookingStatusInput,
  UpdateBookingServicePreferenceInput,
} from '@capella/contracts';

import { api } from '@/lib/api/client';

const query = (input: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
};

export const listBookings = (input: ListBookingsQuery) => (
  api.get<BookingDto[]>(`/erp/bookings${query(input)}`)
);
export const getBooking = (id: number, branchId?: number) => (
  api.get<BookingDto>(`/erp/bookings/${id}${query({ branchId })}`)
);
export const createBooking = (input: CreateBookingInput) => (
  api.post<BookingDto>('/erp/bookings', input)
);
export const updateBookingStatus = (
  id: number,
  input: UpdateBookingStatusInput,
) => api.patch<BookingDto>(`/erp/bookings/${id}/status`, input);
export const listBookingEmployeeOptions = (branchId?: number) => (
  api.get<Array<{ id: number; name: string }>>(`/erp/bookings/employee-options${query({ branchId })}`)
);
export const updateBookingServicePreference = (
  bookingId: number,
  serviceId: number,
  input: UpdateBookingServicePreferenceInput,
) => api.patch<BookingDto>(
  `/erp/bookings/${bookingId}/services/${serviceId}/preference`, input,
);

export type { BookingDto };
