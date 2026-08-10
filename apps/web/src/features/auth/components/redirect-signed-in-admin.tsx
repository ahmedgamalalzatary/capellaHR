'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useSession } from '../hooks/use-session';

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
