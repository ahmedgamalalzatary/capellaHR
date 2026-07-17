import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'الرئيسية' };

export default function DashboardPage() {
  return (
    <div className="text-sm text-muted">
      وحدة «الرئيسية» قيد الإنشاء.
    </div>
  );
}
