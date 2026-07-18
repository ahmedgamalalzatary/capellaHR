import type { Metadata } from 'next';

import { BonusesView } from '@/features/bonuses';

export const metadata: Metadata = { title: 'المكافآت' };

export default function BonusesPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">المكافآت</h2>
      <BonusesView />
    </div>
  );
}
