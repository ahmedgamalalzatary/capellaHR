import type { Metadata } from 'next';

import { EmployeeLoginForm } from '@/features/auth';
import { CairoClock } from '@/components/shell/cairo-clock';

export const metadata: Metadata = { title: 'الخدمة الذاتية' };

export default function SelfServicePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-paper p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">الخدمة الذاتية</h1>
        <p className="mt-1 text-sm text-muted">
          الدخول متاح من هاتفك الشخصي المسجل وأثناء وجود جلسة حضور مفتوحة.
        </p>
      </div>
      <EmployeeLoginForm />
      <CairoClock />
    </main>
  );
}
