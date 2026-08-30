'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { bookingQueryKeys, getBooking } from '@/features/bookings';
import { getClient, type Client } from '@/features/clients';
import {
  employeeAssignmentQueryKeys,
  listAssignableEmployees,
  type AssignableEmployee,
} from '@/features/employee-assignment';

import { errorMessage, type Line } from './sale-primitives';

/**
 * Loads an arrived booking and, once, prefills the workspace from it. A draft
 * the cashier has already started always wins over the booking.
 */
export function useBookingPrefill({
  bookingId,
  branchId,
  draftHydrated,
  activeBookingId,
  offeredDraft,
  hasDraftProgress,
  setBookingPrefillError,
  setClient,
  setLines,
  setActiveBookingId,
}: {
  bookingId?: number;
  branchId?: number;
  draftHydrated: boolean;
  activeBookingId: number | undefined;
  offeredDraft: unknown;
  hasDraftProgress: boolean;
  setBookingPrefillError: (message: string | undefined) => void;
  setClient: (next: Client | null) => void;
  setLines: (next: Line[]) => void;
  setActiveBookingId: (next: number) => void;
}) {
  const booking = useQuery({
    queryKey: bookingQueryKeys.detail(bookingId ?? 0, branchId),
    queryFn: () => getBooking(bookingId!, branchId),
    enabled: bookingId !== undefined,
  });
  const bookingEmployees = useQuery({
    queryKey: employeeAssignmentQueryKeys.present(branchId),
    queryFn: () => listAssignableEmployees(branchId === undefined ? {} : { branchId }),
    enabled: bookingId !== undefined,
  });

  useEffect(() => {
    if (!draftHydrated || activeBookingId !== undefined || offeredDraft || hasDraftProgress) return;
    if (bookingEmployees.isError) {
      setBookingPrefillError(errorMessage(bookingEmployees.error));
      return;
    }
    if (!booking.data || !bookingEmployees.data) return;
    setBookingPrefillError(undefined);
    if (booking.data.status !== 'arrived') {
      setBookingPrefillError('هذا الحجز لم يعد جاهزًا للبيع.');
      return;
    }
    let cancelled = false;
    void getClient(booking.data.client.id, branchId).then((savedClient) => {
      if (cancelled) return;
      const present = new Map<number, AssignableEmployee>(
        bookingEmployees.data.map((item) => [item.id, item]),
      );
      setClient(savedClient);
      setLines(booking.data.services.map((bookedService) => ({
        itemType: 'service' as const,
        quantity: 1,
        unitPrice: bookedService.servicePrice ?? '',
        employee: bookedService.preferredEmployee
          ? present.get(bookedService.preferredEmployee.id) ?? null
          : null,
        service: {
          id: bookedService.serviceId,
          branchId: booking.data.branchId,
          categoryId: 0,
          categoryName: '',
          categoryIsActive: true,
          name: bookedService.serviceName,
          description: null,
          price: bookedService.servicePrice,
          commissionPercent: '0.00',
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      })));
      setActiveBookingId(booking.data.id);
    }).catch((cause) => {
      if (!cancelled) setBookingPrefillError(errorMessage(cause));
    });
    return () => { cancelled = true; };
  }, [
    activeBookingId, booking.data, bookingEmployees.data, bookingEmployees.error, bookingEmployees.isError, branchId,
    draftHydrated, hasDraftProgress, offeredDraft,
    setActiveBookingId, setBookingPrefillError, setClient, setLines,
  ]);

  return { booking, bookingEmployees };
}
