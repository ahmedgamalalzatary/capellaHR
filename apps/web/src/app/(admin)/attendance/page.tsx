import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'الحضور والغياب' };

export default function AttendancePage() {
  return (
    <div className="text-sm text-muted">
      وحدة «الحضور والغياب» قيد الإنشاء.
    </div>
  );
}
