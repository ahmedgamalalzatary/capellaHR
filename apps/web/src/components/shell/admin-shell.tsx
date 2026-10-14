'use client';

import { LogOut } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppShell, Button } from '@capella/ui';

import { useLogout } from '@/features/auth';

import { CairoClock } from './cairo-clock';
import { visibleAdminNav } from './nav';

export function AdminShell({ title, children }: { title?: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();

  return (
    <AppShell
      product={process.env.NEXT_PUBLIC_CAPELLA_EDITION === 'erp' ? 'الحضور' : 'الموارد البشرية'}
      logoSrc="/brand/capella-mark.png"
      navigation={visibleAdminNav()}
      pathname={pathname}
      topbarStart={title ? <h1 className="truncate text-base font-semibold">{title}</h1> : null}
      topbarEnd={(
        <>
          <div className="hidden sm:block">
            <CairoClock />
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={logout.isPending}
            onClick={() => logout.mutate(undefined, { onSuccess: () => router.replace('/login') })}
          >
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">تسجيل الخروج</span>
            <span className="sr-only sm:hidden">تسجيل الخروج</span>
          </Button>
        </>
      )}
    >
      {children}
    </AppShell>
  );
}
