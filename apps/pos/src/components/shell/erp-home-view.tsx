'use client';

import Link from 'next/link';

import { Button, Card, CardContent } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { useSession } from '@/features/auth';
import { CashierSessionView } from '@/features/cashier-sessions';

const adminGroups = [
  {
    title: 'المبيعات والعملاء',
    description: 'تشغيل البيع ومراجعة الفواتير وبيانات العملاء.',
    links: [
      { href: '/sales', label: 'بيع جديد' },
      { href: '/invoices', label: 'الفواتير والإيصالات' },
      { href: '/clients', label: 'العملاء' },
    ],
  },
  {
    title: 'الكتالوج والمخزون',
    description: 'إدارة ما يُباع وما يُشترى وأرصدة كل فرع.',
    links: [
      { href: '/catalog', label: 'إدارة الكتالوج' },
      { href: '/products', label: 'المنتجات والمخزون' },
      { href: '/suppliers', label: 'الموردون والمشتريات' },
    ],
  },
  {
    title: 'المال والمتابعة',
    description: 'متابعة المصروفات والعمولات والتقارير والتصدير.',
    links: [
      { href: '/expenses', label: 'المصروفات' },
      { href: '/commissions', label: 'العمولات' },
      { href: '/reports', label: 'التقارير والتصدير' },
    ],
  },
  {
    title: 'التشغيل والصلاحيات',
    description: 'متابعة ورديات الكاشير وإدارة حسابات التشغيل.',
    links: [
      { href: '/cashier-sessions', label: 'ورديات الكاشير' },
      { href: '/cashier-accounts', label: 'حسابات الكاشير' },
    ],
  },
] as const;

export function ErpHomeView() {
  const session = useSession();
  const actor = session.data?.actor;

  if (session.isPending) return <LoadingState label="جارٍ التحقق من الجلسة…" />;
  if (session.isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-danger">تعذر التحقق من الجلسة. تأكد من اتصالك بالخادم.</p>
        <Button variant="secondary" size="sm" onClick={() => void session.refetch()}>
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (actor && actor.type !== 'admin') return <CashierSessionView />;
  if (!actor) return null;

  return (
    <section className="mx-auto max-w-7xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">لوحة الإدارة</h1>
        <p className="mt-1 text-sm text-muted">
          نقطة واحدة للوصول إلى كل عمليات الإدارة المترابطة دون تكرار شاشات الميزات.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {adminGroups.map((group) => (
          <Card key={group.title}>
            <CardContent className="space-y-3 pt-5">
              <div>
                <h2 className="font-semibold">{group.title}</h2>
                <p className="mt-1 text-sm text-muted">{group.description}</p>
              </div>
              <ul className="space-y-1">
                {group.links.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="block rounded-control px-2 py-1.5 text-sm font-medium underline-offset-4 hover:bg-surface hover:underline"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
