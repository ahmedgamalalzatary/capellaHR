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

  const isAdmin = session.data?.actor.type === 'admin';
  // Redirect only on a resolved "not signed in as admin" answer; network or
  // server failures get a retry state instead of bouncing the user to /login.
  const shouldRedirect = session.isSuccess && !isAdmin;

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

  if (!isAdmin) return null;

  return <>{children}</>;
}
