import type { Metadata } from 'next';

import { AdvancesView } from '@/features/advances';

export const metadata: Metadata = { title: 'السلف' };

export default function AdvancesPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">السلف</h2>
      <AdvancesView />
    </div>
  );
}
