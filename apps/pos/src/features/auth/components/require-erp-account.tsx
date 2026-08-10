'use client';

import { ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Button, Card, CardContent } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';

import { useSession } from '../hooks/use-session';

/**
 * Client-side gate for ERP (Admin/Cashier) pages. The API enforces authorization on
 * every request; this only prevents rendering POS chrome to the wrong actor.
 *
 * Host-only cookies keep normal HR and POS sessions independent. If a valid
 * wrong-application actor is nevertheless returned, it gets an explicit rejection
 * state rather than being treated as signed out.
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
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <LoadingState label="جارٍ التحقق من الجلسة…" className="p-0" />
      </div>
    );
  }

  if (session.isError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Card className="w-full max-w-sm shadow-card">
          <CardContent className="space-y-3 p-6 text-center">
            <p className="text-sm text-danger">تعذر التحقق من الجلسة. تأكد من اتصالك بالخادم.</p>
            <Button variant="secondary" size="sm" onClick={() => void session.refetch()}>
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isUnauthorizedRole) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Card className="w-full max-w-sm shadow-card">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger">
              <ShieldAlert className="size-5" aria-hidden />
            </span>
            <p className="text-sm text-danger">
              {isErpAccount ? 'هذا القسم مخصص للمدير فقط.' : 'هذا الحساب غير مخوّل بالدخول إلى نقطة البيع.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isErpAccount) return null;

  return <>{children}</>;
}
