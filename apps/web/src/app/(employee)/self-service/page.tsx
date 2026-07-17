import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'الخدمة الذاتية' };

export default function SelfServicePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-sm text-muted">
      واجهة الخدمة الذاتية للموظف قيد الإنشاء.
    </main>
  );
}
