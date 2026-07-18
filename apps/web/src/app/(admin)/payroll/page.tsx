import type { Metadata } from 'next';

import { PayrollView } from '@/features/payroll';

export const metadata: Metadata = { title: 'الرواتب' };

export default function PayrollPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">الرواتب</h2>
      <PayrollView />
    </div>
  );
}
