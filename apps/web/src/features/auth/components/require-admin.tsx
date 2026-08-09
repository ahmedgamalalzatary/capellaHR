'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Button } from '@capella/ui';

import { useSession } from '../hooks/use-session';

/**
 * Client-side gate for admin pages. The API enforces authorization on every
 * request; this only prevents rendering admin chrome to signed-out visitors.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useSession();

  const actorType = session.data?.actor.type;
  const isAdmin = actorType === 'admin';
  const isUnauthorizedRole = actorType === 'employee' || actorType === 'cashier';
  // Redirect only when no session exists. A valid wrong-role session gets an
  // explicit state, while network/server failures remain retryable.
  const shouldRedirect = session.isSuccess && !actorType;

  useEffect(() => {
    if (shouldRedirect) router.replace('/login');
  }, [shouldRedirect, router]);

  if (session.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted">
        جارٍ التحقق من الجلسة…
      </div>
    );
  }

  if (session.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-danger">تعذر التحقق من الجلسة. تأكد من اتصالك بالخادم.</p>
        <Button variant="secondary" size="sm" onClick={() => void session.refetch()}>
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (isUnauthorizedRole) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center text-sm text-danger">
        {actorType === 'employee'
          ? 'هذا القسم مخصص للمدير فقط.'
          : 'هذا الحساب غير مخوّل بالدخول إلى نظام الموارد البشرية.'}
      </div>
    );
  }

  if (!isAdmin) return null;

  return <>{children}</>;
}
