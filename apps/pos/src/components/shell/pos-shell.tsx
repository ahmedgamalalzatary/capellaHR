'use client';

import { useQuery } from '@tanstack/react-query';
import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { AppShell, Button, ConfirmDialog, DateTime } from '@capella/ui';

import { useLogout, useSession } from '@/features/auth';
import {
  cashierSessionQueryKeys,
  getCurrentCashierSession,
} from '@/features/cashier-sessions';
import { clearAllSaleDrafts } from '@/features/sales';

import { BranchSwitcher } from './branch-switcher';
import { adminNavigation, cashierNavigation } from './nav';

export function PosShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const logout = useLogout();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const isAdmin = session.data?.actor.type === 'admin';
  const isCashier = session.data?.actor.type === 'cashier';
  const cashierSession = useQuery({
    queryKey: cashierSessionQueryKeys.current(),
    queryFn: () => getCurrentCashierSession(),
    enabled: isCashier,
  });
  const visibleNavigation = isAdmin ? adminNavigation : cashierNavigation;

  const shiftStatus = isCashier ? (
    <div
      className="flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs"
      aria-live="polite"
    >
      {cashierSession.isPending ? (
        <span className="text-muted">جارٍ التحقق من الوردية…</span>
      ) : cashierSession.isError ? (
        <button type="button" className="text-danger" onClick={() => void cashierSession.refetch()}>
          تعذر التحقق — إعادة المحاولة
        </button>
      ) : cashierSession.data ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
          <span className="whitespace-nowrap font-medium text-success">الوردية مفتوحة</span>
          <span aria-hidden className="h-3 w-px shrink-0 bg-line" />
          <span className="truncate text-muted">{cashierSession.data.branchName}</span>
          <span className="hidden whitespace-nowrap text-muted md:inline">
            منذ <DateTime value={cashierSession.data.openedAt} show="time" />
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-muted">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted" />
          <span className="whitespace-nowrap">لا توجد وردية مفتوحة</span>
          <Link href="/" className="whitespace-nowrap font-medium text-ink underline">
            فتح الوردية
          </Link>
        </span>
      )}
    </div>
  ) : null;

  const accountFooter = isAdmin || isCashier ? (
    <p className="flex items-center gap-2 rounded-control bg-flap px-2.5 py-2 text-[12px] text-board-muted">
      {isAdmin ? (
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
      ) : (
        <UserRound className="size-4 shrink-0" aria-hidden />
      )}
      {isAdmin ? 'حساب المدير' : 'حساب كاشير'}
    </p>
  ) : null;

  return (
    <>
      <AppShell
        product="نقطة البيع"
        logoSrc="/brand/capella-mark.png"
        navigation={visibleNavigation}
        pathname={pathname}
        topbarStart={isAdmin ? <BranchSwitcher /> : null}
        {...(accountFooter ? { sidebarFooter: accountFooter } : {})}
        topbarEnd={(
          <>
            {shiftStatus}
            <Button
              variant="ghost"
              size="sm"
              aria-label="تسجيل الخروج"
              disabled={logout.isPending}
              onClick={() => setConfirmLogout(true)}
            >
              <LogOut className="size-4" aria-hidden />
              <span className="hidden sm:inline">تسجيل الخروج</span>
            </Button>
          </>
        )}
      >
        {children}
      </AppShell>

      {confirmLogout ? (
        <ConfirmDialog
          title="تسجيل الخروج"
          description="سيُحذف أي بيع غير مكتمل محفوظ على هذا الجهاز."
          confirmLabel="تأكيد الخروج"
          tone="danger"
          pending={logout.isPending}
          onConfirm={() => {
            clearAllSaleDrafts();
            logout.mutate(undefined, { onSuccess: () => router.replace('/login') });
          }}
          onCancel={() => setConfirmLogout(false)}
        />
      ) : null}
    </>
  );
}
