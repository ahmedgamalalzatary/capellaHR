'use client';

import { useQuery } from '@tanstack/react-query';
import { Clock3, ShieldAlert } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Button, Card, CardContent } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { useSession } from '@/features/auth';
import { cashierSessionQueryKeys, getCurrentCashierSession } from '@/features/cashier-sessions';

import { isActiveNavItem, receptionNavigation } from './nav';

export const RECEPTION_NO_SHIFT_MESSAGE = 'لا توجد وردية مفتوحة. اطلب من الكاشير فتح الوردية.';

const receptionPaths = receptionNavigation.flatMap((group) => group.items.map((item) => item.href));

function Notice({ icon: Icon, tone, children }: {
  icon: typeof Clock3;
  tone: 'danger' | 'muted';
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-sm shadow-card">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <span
            className={tone === 'danger'
              ? 'flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger'
              : 'flex size-10 items-center justify-center rounded-full bg-surface text-muted'}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

/** The shared branch shift, as Reception reads it (status only, never opened here). */
export function useReceptionShift(enabled: boolean) {
  return useQuery({
    queryKey: cashierSessionQueryKeys.current(),
    queryFn: () => getCurrentCashierSession(),
    enabled,
  });
}

/**
 * Keeps a Reception login on its own pages. It may open the home screen any
 * time (shift status); the front-desk pages need the shift the cashier opened.
 * The API enforces the same rules; this only spares the user dead screens.
 * Every other account passes straight through.
 */
export function ReceptionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const session = useSession();
  const isReception = session.data?.actor.type === 'reception';
  const isHome = pathname === '/';
  const allowed = receptionPaths.some((href) => isActiveNavItem(href, pathname));
  const shift = useReceptionShift(isReception && allowed && !isHome);

  if (session.isPending) return <LoadingState label="جارٍ التحقق من الجلسة…" />;
  if (!isReception || isHome) return <>{children}</>;

  if (!allowed) {
    return (
      <Notice icon={ShieldAlert} tone="danger">
        <p className="text-sm text-danger">هذه الصفحة غير متاحة لحساب الاستقبال.</p>
      </Notice>
    );
  }
  if (shift.isPending) return <LoadingState label="جارٍ التحقق من الوردية…" />;
  if (shift.isError) {
    return (
      <Notice icon={ShieldAlert} tone="danger">
        <p className="text-sm text-danger">تعذر التحقق من الوردية.</p>
        <Button variant="secondary" size="sm" onClick={() => void shift.refetch()}>
          إعادة المحاولة
        </Button>
      </Notice>
    );
  }
  if (!shift.data) {
    return (
      <Notice icon={Clock3} tone="muted">
        <p className="text-sm text-ink">{RECEPTION_NO_SHIFT_MESSAGE}</p>
      </Notice>
    );
  }
  return <>{children}</>;
}
