import type { Metadata } from 'next';

import { Card, CardContent } from '@capella/ui';

import { CairoClock } from '@/components/shell/cairo-clock';

export const metadata: Metadata = { title: 'تسجيل الدخول' };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-paper p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">كابيلا</h1>
        <p className="mt-1 text-sm text-muted">نظام الموارد البشرية</p>
      </div>
      <Card className="w-full max-w-sm">
        <CardContent className="py-10 text-center text-sm text-muted">
          نموذج تسجيل دخول المدير قيد الإنشاء بانتظار واجهة الخادم.
        </CardContent>
      </Card>
      <CairoClock />
    </main>
  );
}
