import type { Metadata } from 'next';

import { EmployeesView } from '@/features/employees';

export const metadata: Metadata = { title: 'الموظفون' };

export default function EmployeesPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">الموظفون</h2>
      <EmployeesView />
    </div>
  );
}
