import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ShiftDetailView } from '@/features/cashier-sessions';

export const metadata: Metadata = { title: 'تفاصيل الوردية' };

export default async function CashierSessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  // An unreadable identifier is not a shift, so it is missing rather than an error.
  if (!/^\d+$/.test(sessionId)) notFound();
  return <ShiftDetailView sessionId={Number(sessionId)} />;
}
