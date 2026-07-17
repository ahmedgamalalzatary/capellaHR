import type { Metadata } from 'next';

import { BranchesView } from '@/features/branches';

export const metadata: Metadata = { title: 'الفروع' };

export default function BranchesPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">الفروع</h2>
      <BranchesView />
    </div>
  );
}
