export const bookingQueryKeys = {
  all: ['erp-bookings'] as const,
  day: (date: string, branchId?: number) => ['erp-bookings', 'day', date, branchId ?? 'own'] as const,
  detail: (id: number, branchId?: number) => ['erp-bookings', 'detail', id, branchId ?? 'own'] as const,
};
