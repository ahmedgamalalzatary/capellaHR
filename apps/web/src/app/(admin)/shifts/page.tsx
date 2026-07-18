import type { Metadata } from 'next';

import { ShiftsView } from '@/features/shifts';

export const metadata: Metadata = { title: 'الورديات' };

export default function ShiftsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">الورديات</h2>
      <ShiftsView />
    </div>
  );
}
