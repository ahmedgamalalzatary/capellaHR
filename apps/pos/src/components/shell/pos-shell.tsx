'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useIsMutating, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { Button, cn } from '@capella/ui';

import { useLogout, useSession } from '@/features/auth';
import {
  cashierSessionQueryKeys,
  getCurrentCashierSession,
} from '@/features/cashier-sessions';
import { clearAllSaleDrafts } from '@/features/sales';

type NavigationItem = { href: string; label: string };
type NavigationGroup = { label: string; items: NavigationItem[] };

const adminNavigation: NavigationGroup[] = [
  {
    label: 'المبيعات والعملاء',
    items: [
      { href: '/', label: 'لوحة الإدارة' },
      { href: '/sales', label: 'بيع جديد' },
      { href: '/invoices', label: 'الفواتير' },
      { href: '/clients', label: 'العملاء' },
    ],
  },
  {
    label: 'الإدارة',
    items: [
      { href: '/cashier-sessions', label: 'ورديات الكاشير' },
      { href: '/catalog', label: 'الكتالوج' },
      { href: '/products', label: 'المنتجات والمخزون' },
      { href: '/suppliers', label: 'الموردون والمشتريات' },
      { href: '/expenses', label: 'المصروفات' },
    ],
  },
  {
    label: 'المتابعة',
    items: [
      { href: '/commissions', label: 'العمولات' },
      { href: '/reports', label: 'التقارير' },
    ],
  },
  {
    label: 'النظام',
    items: [{ href: '/cashier-accounts', label: 'حسابات الكاشير' }],
  },
];

const cashierNavigation: NavigationGroup[] = [{
  label: 'نقطة البيع',
  items: [
    { href: '/', label: 'الوردية' },
    { href: '/sales', label: 'بيع جديد' },
    { href: '/invoices', label: 'الفواتير' },
    { href: '/clients', label: 'العملاء' },
    { href: '/services', label: 'الخدمات' },
  ],
}];

export function PosShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const logout = useLogout();
  const navigationLocked = useIsMutating() > 0;
  const isAdmin = session.data?.actor.type === 'admin';
  const isCashier = session.data?.actor.type === 'cashier';
  const cashierSession = useQuery({
    queryKey: cashierSessionQueryKeys.current(),
    queryFn: () => getCurrentCashierSession(),
    enabled: isCashier,
  });
  const visibleNavigation = isAdmin ? adminNavigation : cashierNavigation;

  return (
    <div className="min-h-dvh">
      <a
        href="#pos-content"
        className="sr-only z-50 rounded-control bg-ink px-3 py-2 text-paper focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        الانتقال إلى المحتوى
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 px-3 py-3 backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            aria-disabled={navigationLocked || undefined}
            className={cn('text-sm font-bold text-ink', navigationLocked && 'pointer-events-none opacity-50')}
            onClick={(event) => { if (navigationLocked) event.preventDefault(); }}
          >كابيلا — نقطة البيع</Link>
          <div className="flex items-center gap-2">
            {isCashier ? (
              <div className="rounded-full border border-line px-3 py-1 text-xs" aria-live="polite">
                {cashierSession.isPending ? 'جارٍ التحقق من الوردية…' : cashierSession.isError ? (
                  <button type="button" className="text-danger" onClick={() => void cashierSession.refetch()}>
                    تعذر التحقق — إعادة المحاولة
                  </button>
                ) : cashierSession.data ? (
                  <span><span className="font-medium text-success">الوردية مفتوحة</span> · {cashierSession.data.branchName}</span>
                ) : 'لا توجد وردية مفتوحة'}
              </div>
            ) : isAdmin ? <span className="text-xs text-muted">حساب المدير</span> : null}
            <Button
              variant="ghost"
              size="sm"
              disabled={logout.isPending || navigationLocked}
              onClick={() => {
                if (navigationLocked) return;
                clearAllSaleDrafts();
                logout.mutate(undefined, { onSuccess: () => router.replace('/login') });
              }}
            >
              تسجيل الخروج
            </Button>
          </div>
        </div>
        <nav aria-label="التنقل الرئيسي" className="mx-auto mt-3 max-w-7xl overflow-x-auto pb-1">
          <div className={cn('grid min-w-max gap-2', isAdmin ? 'grid-cols-4' : 'grid-cols-1')}>
            {visibleNavigation.map((group) => (
              <div
                key={group.label}
                role="group"
                aria-label={group.label}
                className="rounded-control border border-line/80 p-1"
              >
                {isAdmin ? (
                  <p className="px-2 pb-0.5 text-[11px] font-medium text-muted">{group.label}</p>
                ) : null}
                <div className="flex gap-1">
                  {group.items.map((item) => {
                    const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        aria-disabled={navigationLocked || undefined}
                        onClick={(event) => { if (navigationLocked) event.preventDefault(); }}
                        className={cn(
                          'whitespace-nowrap rounded-control px-2.5 py-1.5 text-sm transition-colors',
                          active ? 'bg-ink text-paper' : 'text-muted hover:bg-surface hover:text-ink',
                          navigationLocked && 'pointer-events-none opacity-50',
                        )}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>
      </header>
      <main id="pos-content" tabIndex={-1} className="p-3 sm:p-4">{children}</main>
    </div>
  );
}
