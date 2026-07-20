'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { Button, Card } from '@capella/ui';

import { CairoClock } from '@/components/shell/cairo-clock';
import { EmployeeLoginForm, useSession } from '@/features/auth';

import { SelfServiceView } from './self-service-view';

const Centered = ({ children }: { children: React.ReactNode }) => (
  <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface p-6 text-center">
    {children}
  </main>
);

export function SelfServiceEntry() {
  const session = useSession();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!session.isPending && session.data === null) {
      queryClient.removeQueries({ queryKey: ['self-service'] });
    }
  }, [queryClient, session.data, session.isPending]);

  if (session.isPending) {
    return <Centered><p className="text-sm text-muted">جارٍ التحقق من الجلسة…</p></Centered>;
  }

  if (session.isError) {
    return (
      <Centered>
        <Card className="max-w-md space-y-3 p-6">
          <p className="font-semibold">تعذر التحقق من الجلسة</p>
          <p className="text-sm text-muted">تحقق من اتصالك بالخادم ثم حاول مرة أخرى.</p>
          <Button variant="secondary" size="sm" onClick={() => void session.refetch()}>إعادة المحاولة</Button>
        </Card>
      </Centered>
    );
  }

  if (session.data?.actor.type === 'employee') return <SelfServiceView />;

  if (session.data?.actor.type === 'admin') {
    return (
      <Centered>
        <Card className="max-w-md space-y-2 p-6">
          <h1 className="text-lg font-bold">هذه الصفحة مخصصة للموظفين</h1>
          <p className="text-sm text-muted">استخدم لوحة الإدارة للوصول إلى سجلات الشركة.</p>
        </Card>
      </Centered>
    );
  }

  return (
    <Centered>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">الخدمة الذاتية</h1>
        <p className="mt-1 max-w-md text-sm text-muted">
          الدخول متاح من هاتفك الشخصي المسجل وأثناء وجود جلسة حضور مفتوحة.
        </p>
      </div>
      <EmployeeLoginForm />
      <CairoClock />
    </Centered>
  );
}
