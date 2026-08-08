'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useSession } from '../hooks/use-session';

/**
 * Keeps a signed-in admin off the login screen. Only a resolved admin session redirects:
 * an unauthenticated answer, a still-loading check, or a failed one all fall through to
 * the form, so a session-check outage can never make signing in impossible.
 */
export function RedirectSignedInAdmin({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const isAdmin = session.data?.actor.type === 'admin';

  useEffect(() => {
    if (isAdmin) router.replace('/dashboard');
  }, [isAdmin, router]);

  if (isAdmin) return null;

  return <>{children}</>;
}
