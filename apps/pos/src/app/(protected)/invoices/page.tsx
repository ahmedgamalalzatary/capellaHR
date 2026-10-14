import type { Metadata } from 'next';

import { InvoiceHistoryView } from '@/features/sales';

export const metadata: Metadata = { title: 'الفواتير' };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ branchId?: string }>;
}) {
  const query = await searchParams;
  const candidateBranchId = query.branchId ? Number(query.branchId) : undefined;
  const branchId = typeof candidateBranchId === 'number'
    && Number.isSafeInteger(candidateBranchId)
    && candidateBranchId > 0
    ? candidateBranchId
    : undefined;
  return <InvoiceHistoryView
    {...(branchId === undefined ? {} : { initialBranchId: branchId })}
  />;
}
