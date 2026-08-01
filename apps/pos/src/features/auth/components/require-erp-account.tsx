'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Button } from '@capella/ui';

import { useSession } from '../hooks/use-session';

/**
 * Client-side gate for ERP (Admin/Cashier) pages. The API enforces authorization on
 * every request; this only prevents rendering POS chrome to the wrong actor.
 *
 * The `capella_session` cookie is shared with the HR web app, so an HR employee
 * session is visible here too. That case gets an explicit rejection message rather
 * than a silent redirect, since redirecting could read as "not logged in" when the
 * visitor is in fact signed in — just to the wrong app.
 */
export function RequireErpAccount({
  children,
  role,
}: {
  children: ReactNode;
  /** Restrict further to a single ERP role, e.g. admin-only pages like cashier-account management. */
  role?: 'admin';
}) {
  const router = useRouter();
  const session = useSession();

  const actorType = session.data?.actor.type;
  const isAdmin = actorType === 'admin';
  const isCashier = actorType === 'cashier';
  const isErpAccount = isAdmin || isCashier;
  const meetsRole = role === 'admin' ? isAdmin : isErpAccount;
  const isUnauthorizedRole = actorType === 'employee' || (isErpAccount && !meetsRole);
  // Redirect only on a resolved "not signed in at all" answer; network/server
  // failures get a retry state, and an employee/wrong-role session gets its own message.
  const shouldRedirect = session.isSuccess && !isErpAccount && !isUnauthorizedRole;

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
        {isErpAccount ? 'هذا القسم مخصص للمدير فقط.' : 'هذا الحساب غير مخوّل بالدخول إلى نقطة البيع.'}
      </div>
    );
  }

  if (!isErpAccount) return null;

  return <>{children}</>;
}
