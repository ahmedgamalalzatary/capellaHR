'use client';

import { useIsMutating, useQuery } from '@tanstack/react-query';
import { ShieldCheck, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useLogout, useSession } from '@/features/auth';
import {
  cashierSessionQueryKeys,
  getCurrentCashierSession,
} from '@/features/cashier-sessions';
import { clearAllSaleDrafts } from '@/features/sales';

import { adminNavigation, cashierNavigation } from './nav';
import { Sidebar, SIDEBAR_ID } from './sidebar';
import { Topbar } from './topbar';

export function PosShell({ children }: { children: ReactNode }) {
  const router = useRouter();
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

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const wideRef = useRef(false);

  useEffect(() => {
    const breakpoint = window.matchMedia('(min-width: 48rem)');
    wideRef.current = breakpoint.matches;
    if (breakpoint.matches) setSidebarOpen(false);
    const onBreakpointChange = (event: MediaQueryListEvent) => {
      wideRef.current = event.matches;
      if (event.matches) setSidebarOpen(false);
    };
    breakpoint.addEventListener('change', onBreakpointChange);
    return () => breakpoint.removeEventListener('change', onBreakpointChange);
  }, []);

  // The open state is only reachable through the md:hidden toggle, so this effect
  // manages the mobile drawer: move focus in, trap Tab, restore it on close.
  useEffect(() => {
    if (!sidebarOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sidebar = document.getElementById(SIDEBAR_ID);
    const focusables = () =>
      Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (sidebar && (active === null || !sidebar.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (trigger?.isConnected && !wideRef.current) {
        const style = window.getComputedStyle(trigger);
        if (!trigger.hidden && style.display !== 'none' && style.visibility !== 'hidden') {
          trigger.focus();
        }
      }
    };
  }, [sidebarOpen]);

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
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-muted">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted" />
          <span className="whitespace-nowrap">لا توجد وردية مفتوحة</span>
        </span>
      )}
    </div>
  ) : null;

  const accountFooter = isAdmin || isCashier ? (
    <p className="flex items-center gap-2 rounded-control bg-surface px-2.5 py-2 text-[12px] text-muted">
      {isAdmin ? (
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
      ) : (
        <UserRound className="size-4 shrink-0" aria-hidden />
      )}
      {isAdmin ? 'حساب المدير' : 'حساب كاشير'}
    </p>
  ) : null;

  return (
    <div className="min-h-dvh">
      <a
        href="#pos-content"
        className="sr-only z-50 rounded-control bg-ink px-3 py-2 text-paper focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        الانتقال إلى المحتوى
      </a>

      {sidebarOpen ? (
        <div
          data-testid="sidebar-backdrop"
          aria-hidden
          className="fixed inset-0 z-30 bg-ink/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <Sidebar
        navigation={visibleNavigation}
        open={sidebarOpen}
        locked={navigationLocked}
        {...(accountFooter ? { footer: accountFooter } : {})}
        onNavigate={() => setSidebarOpen(false)}
      />

      <div className="flex min-h-dvh flex-col md:ms-56 lg:ms-64">
        <Topbar
          menuOpen={sidebarOpen}
          onMenuToggle={() => setSidebarOpen((open) => !open)}
          {...(shiftStatus ? { status: shiftStatus } : {})}
          locked={navigationLocked}
          logoutPending={logout.isPending}
          onLogout={() => {
            if (navigationLocked) return;
            clearAllSaleDrafts();
            logout.mutate(undefined, { onSuccess: () => router.replace('/login') });
          }}
        />
        <main
          id="pos-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-3 py-5 sm:px-6 sm:py-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
