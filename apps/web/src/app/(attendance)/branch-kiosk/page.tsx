import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'هاتف الفرع' };

export default function BranchKioskPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-sm text-muted">
      واجهة هاتف الفرع المشترك قيد الإنشاء.
    </main>
  );
}
