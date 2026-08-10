'use client';

import Link from 'next/link';
import { LogOut, Menu, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button, cn } from '@capella/ui';

import { SIDEBAR_ID } from './sidebar';

/**
 * The counter's always-visible status bar: it opens the drawer on a phone, keeps
 * the shift state in sight, and never lets the till be abandoned mid-command.
 */
export function Topbar({
  menuOpen,
  onMenuToggle,
  status,
  locked = false,
  logoutPending = false,
  onLogout,
}: {
  menuOpen: boolean;
  onMenuToggle: () => void;
  /** Shift or role state; rendered once so assistive tech announces a single source. */
  status?: ReactNode;
  locked?: boolean;
  logoutPending?: boolean;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-paper/90 px-3 backdrop-blur sm:px-6">
      <Button
        variant="ghost"
        size="sm"
        className="md:hidden"
        aria-label={menuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
        aria-expanded={menuOpen}
        aria-controls={SIDEBAR_ID}
        onClick={onMenuToggle}
      >
        {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </Button>

      {/* The brand lives in the rail from md up; below sm the shift state earns the room. */}
      <Link
        href="/"
        aria-disabled={locked || undefined}
        className={cn(
          'hidden text-sm font-bold text-ink sm:block md:hidden',
          locked && 'pointer-events-none opacity-50',
        )}
        onClick={(event) => { if (locked) event.preventDefault(); }}
      >
        كابيلا — نقطة البيع
      </Link>

      <div className="ms-auto flex min-w-0 items-center gap-1.5 sm:gap-3">
        {status}
        <Button
          variant="ghost"
          size="sm"
          aria-label="تسجيل الخروج"
          disabled={logoutPending || locked}
          onClick={onLogout}
        >
          <LogOut className="size-4" aria-hidden />
          <span className="hidden lg:inline">تسجيل الخروج</span>
        </Button>
      </div>
    </header>
  );
}
