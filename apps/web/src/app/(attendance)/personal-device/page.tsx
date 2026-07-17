import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'جهازي الشخصي' };

export default function PersonalDevicePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-sm text-muted">
      واجهة الحضور من الهاتف الشخصي قيد الإنشاء.
    </main>
  );
}
