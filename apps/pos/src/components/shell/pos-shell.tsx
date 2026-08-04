'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { Button } from '@capella/ui';

import { useLogout, useSession } from '@/features/auth';

export function PosShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const logout = useLogout();
  const isAdmin = session.data?.actor.type === 'admin';

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-bold text-ink">كابيلا — نقطة البيع</span>
          <Link href="/sales" className="text-sm font-medium text-ink hover:text-muted">
            بيع جديد
          </Link>
          {/* Cashiers need clients to complete a sale, so this is not admin-only. */}
          <Link href="/clients" className="text-sm text-muted hover:text-ink">
            العملاء
          </Link>
          {!isAdmin ? (
            <Link href="/services" className="text-sm text-muted hover:text-ink">
              الخدمات
            </Link>
          ) : null}
          {isAdmin ? (
            <>
              {/* Catalog administration decides what is sellable and what it costs. */}
              <Link href="/catalog" className="text-sm text-muted hover:text-ink">
                الكتالوج
              </Link>
              <Link href="/cashier-accounts" className="text-sm text-muted hover:text-ink">
                حسابات الكاشير
              </Link>
            </>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSuccess: () => router.replace('/login') })}
        >
          تسجيل الخروج
        </Button>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
