import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'الإجازة الأسبوعية' };

export default function WeeklyDayOffPage() {
  return (
    <div className="text-sm text-muted">
      وحدة «الإجازة الأسبوعية» قيد الإنشاء.
    </div>
  );
}
