'use client';

import { LogOut, Menu, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@capella/ui';

import { useLogout } from '@/features/auth';

import { CairoClock } from './cairo-clock';

export function Topbar({
  title,
  menuOpen = false,
  onMenuToggle,
}: {
  title?: string | undefined;
  menuOpen?: boolean;
  onMenuToggle?: () => void;
}) {
  const router = useRouter();
  const logout = useLogout();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-paper/95 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2">
        {onMenuToggle ? (
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            aria-label={menuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={menuOpen}
            aria-controls="admin-sidebar"
            onClick={onMenuToggle}
          >
            {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </Button>
        ) : null}
        {title ? <h1 className="text-base font-semibold">{title}</h1> : null}
      </div>
      <div className="flex items-center gap-2 sm:gap-4">
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
      </div>
    </header>
  );
}
