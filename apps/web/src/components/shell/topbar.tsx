'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@capella/ui';

import { useLogout } from '@/features/auth';

import { CairoClock } from './cairo-clock';

export function Topbar({ title }: { title?: string }) {
  const router = useRouter();
  const logout = useLogout();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-paper/95 px-6 backdrop-blur">
      <h1 className="text-base font-semibold">{title}</h1>
      <div className="flex items-center gap-4">
        <CairoClock />
        <Button
          variant="ghost"
          size="sm"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSettled: () => router.replace('/login') })}
        >
          <LogOut className="size-4" aria-hidden />
          تسجيل الخروج
        </Button>
      </div>
    </header>
  );
}
