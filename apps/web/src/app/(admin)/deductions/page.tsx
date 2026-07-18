import type { Metadata } from 'next';

import { DeductionsView } from '@/features/deductions';

export const metadata: Metadata = { title: 'الخصومات' };

export default function DeductionsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">الخصومات</h2>
      <DeductionsView />
    </div>
  );
}
