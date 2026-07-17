'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useSession } from '../hooks/use-session';

/**
 * Client-side gate for admin pages. The API enforces authorization on every
 * request; this only prevents rendering admin chrome to signed-out visitors.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useSession();

  const isAdmin = session.data?.actor.type === 'admin';

  useEffect(() => {
    if (!session.isPending && !isAdmin) {
      router.replace('/login');
    }
  }, [session.isPending, isAdmin, router]);

  if (session.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted">
        جارٍ التحقق من الجلسة…
      </div>
    );
  }

  if (!isAdmin) return null;

  return <>{children}</>;
}
