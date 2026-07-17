import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'الموظفون' };

export default function EmployeesPage() {
  return (
    <div className="text-sm text-muted">
      وحدة «الموظفون» قيد الإنشاء.
    </div>
  );
}
