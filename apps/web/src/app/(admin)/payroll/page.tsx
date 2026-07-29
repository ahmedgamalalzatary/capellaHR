import type { Metadata } from 'next';

import { PayrollView } from '@/features/payroll';
import { ProtectedAreaGate } from '@/features/protected-area';

export const metadata: Metadata = { title: 'الرواتب' };

export default function PayrollPage() {
  return (
    <ProtectedAreaGate area="payroll">
      <div className="space-y-4">
        <h2 className="text-lg font-bold">الرواتب</h2>
        <PayrollView />
      </div>
    </ProtectedAreaGate>
  );
}
