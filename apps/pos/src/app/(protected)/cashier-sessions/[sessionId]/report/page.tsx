import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ShiftEndingReport } from '@/features/cashier-sessions';

export const metadata: Metadata = { title: 'تقرير نهاية الوردية' };

export default async function ShiftEndingReportPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (!/^\d+$/.test(sessionId)) notFound();
  return <ShiftEndingReport sessionId={Number(sessionId)} />;
}
