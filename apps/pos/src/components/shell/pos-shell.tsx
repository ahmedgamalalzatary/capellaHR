'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { Button, cn } from '@capella/ui';

import { useLogout, useSession } from '@/features/auth';
import {
  cashierSessionQueryKeys,
  getCurrentCashierSession,
} from '@/features/cashier-sessions';
import { clearAllSaleDrafts } from '@/features/sales';

type NavigationItem = { href: string; label: string; adminOnly?: boolean; cashierOnly?: boolean };

const navigation: NavigationItem[] = [
  { href: '/', label: 'الوردية' },
  { href: '/sales', label: 'بيع جديد' },
  { href: '/clients', label: 'العملاء' },
  { href: '/services', label: 'الخدمات', cashierOnly: true },
  { href: '/catalog', label: 'الكتالوج', adminOnly: true },
  { href: '/cashier-accounts', label: 'حسابات الكاشير', adminOnly: true },
];

export function PosShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const logout = useLogout();
  const isAdmin = session.data?.actor.type === 'admin';
  const isCashier = session.data?.actor.type === 'cashier';
  const cashierSession = useQuery({
    queryKey: cashierSessionQueryKeys.current(),
    queryFn: () => getCurrentCashierSession(),
    enabled: isCashier,
  });
  const visibleNavigation = navigation.filter((item) => (
    (!item.adminOnly || isAdmin) && (!item.cashierOnly || isCashier)
  ));

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
          <Link href="/" className="text-sm font-bold text-ink">كابيلا — نقطة البيع</Link>
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
              disabled={logout.isPending}
              onClick={() => {
                clearAllSaleDrafts();
                logout.mutate(undefined, { onSuccess: () => router.replace('/login') });
              }}
            >
              تسجيل الخروج
            </Button>
          </div>
        </div>
        <nav aria-label="التنقل الرئيسي" className="mx-auto mt-3 max-w-7xl overflow-x-auto">
          <div className="flex min-w-max gap-1">
            {visibleNavigation.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-control px-3 py-2 text-sm transition-colors',
                    active ? 'bg-ink text-paper' : 'text-muted hover:bg-surface hover:text-ink',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>
      <main id="pos-content" tabIndex={-1} className="p-3 sm:p-4">{children}</main>
    </div>
  );
}
