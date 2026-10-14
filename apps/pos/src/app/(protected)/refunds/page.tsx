import type { Metadata } from 'next';

import { RefundsView } from '@/features/sales';

export const metadata: Metadata = { title: 'المرتجعات' };

export default async function RefundsPage({
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
  return <RefundsView
    {...(branchId === undefined ? {} : { initialBranchId: branchId })}
  />;
}
