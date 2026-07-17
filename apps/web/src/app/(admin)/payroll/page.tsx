import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'الرواتب' };

export default function PayrollPage() {
  return (
    <div className="text-sm text-muted">
      وحدة «الرواتب» قيد الإنشاء.
    </div>
  );
}
