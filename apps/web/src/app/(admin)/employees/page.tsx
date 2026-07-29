import type { Metadata } from 'next';

import { EmployeesView } from '@/features/employees';
import { ProtectedAreaGate } from '@/features/protected-area';

export const metadata: Metadata = { title: 'الموظفون' };

export default function EmployeesPage() {
  return (
    <ProtectedAreaGate area="employees">
      <div className="space-y-4">
        <h2 className="text-lg font-bold">الموظفون</h2>
        <EmployeesView />
      </div>
    </ProtectedAreaGate>
  );
}
