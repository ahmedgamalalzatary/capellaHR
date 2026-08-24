import type { Metadata } from 'next';

import { SalesView } from '@/features/sales';

export const metadata: Metadata = { title: 'بيع جديد' };

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ bookingId?: string }>;
}) {
  const { bookingId: rawBookingId } = await searchParams;
  const bookingId = rawBookingId && /^\d+$/.test(rawBookingId) ? Number(rawBookingId) : undefined;
  return <SalesView {...(bookingId === undefined ? {} : { bookingId })} />;
}
