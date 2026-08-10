'use client';

import {
  Boxes,
  ChevronLeft,
  ShoppingCart,
  UserCog,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { Button, Card, CardContent } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { PageHeader } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { CashierSessionView } from '@/features/cashier-sessions';

const adminGroups: ReadonlyArray<{
  title: string;
  description: string;
  icon: LucideIcon;
  links: ReadonlyArray<{ href: string; label: string }>;
}> = [
  {
    title: 'المبيعات والعملاء',
    description: 'تشغيل البيع ومراجعة الفواتير وبيانات العملاء.',
    icon: ShoppingCart,
    links: [
      { href: '/sales', label: 'بيع جديد' },
      { href: '/invoices', label: 'الفواتير والإيصالات' },
      { href: '/clients', label: 'العملاء' },
    ],
  },
  {
    title: 'الكتالوج والمخزون',
    description: 'إدارة ما يُباع وما يُشترى وأرصدة كل فرع.',
    icon: Boxes,
    links: [
      { href: '/catalog', label: 'إدارة الكتالوج' },
      { href: '/products', label: 'المنتجات والمخزون' },
      { href: '/suppliers', label: 'الموردون والمشتريات' },
    ],
  },
  {
    title: 'المال والمتابعة',
    description: 'متابعة المصروفات والعمولات والتقارير والتصدير.',
    icon: Wallet,
    links: [
      { href: '/expenses', label: 'المصروفات' },
      { href: '/commissions', label: 'العمولات' },
      { href: '/reports', label: 'التقارير والتصدير' },
    ],
  },
  {
    title: 'التشغيل والصلاحيات',
    description: 'متابعة ورديات الكاشير وإدارة حسابات التشغيل.',
    icon: UserCog,
    links: [
      { href: '/cashier-sessions', label: 'ورديات الكاشير' },
      { href: '/cashier-accounts', label: 'حسابات الكاشير' },
    ],
  },
];

export function ErpHomeView() {
  const session = useSession();
  const actor = session.data?.actor;

  if (session.isPending) return <LoadingState label="جارٍ التحقق من الجلسة…" />;
  if (session.isError) {
    return (
      <Card className="mx-auto max-w-md shadow-card">
        <CardContent role="alert" className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-danger">تعذر التحقق من الجلسة. تأكد من اتصالك بالخادم.</p>
          <Button variant="secondary" size="sm" onClick={() => void session.refetch()}>
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (actor && actor.type !== 'admin') return <CashierSessionView />;
  if (!actor) return <LoadingState label="جارٍ التحقق من الجلسة…" />;

  return (
    <section className="space-y-6">
      <PageHeader
        title="لوحة الإدارة"
        description="نقطة واحدة للوصول إلى كل عمليات الإدارة المترابطة دون تكرار شاشات الميزات."
      />
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {adminGroups.map((group) => (
          <Card key={group.title} className="shadow-card transition-shadow hover:shadow-raised">
            <CardContent className="flex h-full flex-col gap-4 p-5">
              <div>
                <span className="mb-3 inline-flex size-9 items-center justify-center rounded-control border border-line bg-surface text-ink">
                  <group.icon className="size-4" aria-hidden />
                </span>
                <h2 className="text-sm font-semibold text-ink">{group.title}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{group.description}</p>
              </div>
              <ul className="mt-auto space-y-0.5 border-t border-line/70 pt-3">
                {group.links.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-2 rounded-control px-2 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface"
                    >
                      {item.label}
                      <ChevronLeft className="size-4 shrink-0 text-muted" aria-hidden />
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
