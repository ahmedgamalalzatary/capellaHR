'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@capella/ui';

import { isActiveNavItem, type NavGroup } from './nav';

export const SIDEBAR_ID = 'pos-sidebar';

/**
 * Primary destinations for the counter. It is a permanent rail from `md` up —
 * the compact 768px till still shows every workspace without a menu tap — and a
 * dismissible drawer below that, where the sale itself needs the full width.
 */
export function Sidebar({
  navigation,
  open = false,
  locked = false,
  footer,
  onNavigate,
}: {
  navigation: NavGroup[];
  open?: boolean;
  /** A running command must not be abandoned mid-flight by a stray tap. */
  locked?: boolean;
  footer?: ReactNode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      id={SIDEBAR_ID}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'fixed inset-y-0 start-0 z-40 flex w-72 max-w-[85vw] flex-col border-e border-line bg-paper',
        'transition-[transform,visibility] duration-200 md:w-56 md:max-w-none lg:w-64',
        'md:visible md:translate-x-0 md:shadow-none',
        // Visibility, not only transform, keeps the closed drawer out of keyboard
        // and screen-reader order below md.
        open ? 'visible translate-x-0 shadow-panel' : 'invisible translate-x-full',
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-5">
        <Link
          href="/"
          aria-disabled={locked || undefined}
          className={cn(
            'flex min-w-0 items-baseline gap-2',
            locked && 'pointer-events-none opacity-50',
          )}
          onClick={(event) => {
            if (locked) {
              event.preventDefault();
              return;
            }
            onNavigate?.();
          }}
        >
          <span className="text-lg font-bold tracking-tight text-ink">كابيلا</span>
          <span className="truncate text-[12px] text-muted">نقطة البيع</span>
        </Link>
      </div>

      <nav
        aria-label="التنقل الرئيسي"
        className="scroll-thin flex-1 overflow-y-auto px-3 py-4"
      >
        {navigation.map((group) => (
          <div key={group.label} role="group" aria-label={group.label} className="mb-5 last:mb-0">
            <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wide text-muted">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActiveNavItem(item.href, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      aria-disabled={locked || undefined}
                      onClick={(event) => {
                        if (locked) {
                          event.preventDefault();
                          return;
                        }
                        onNavigate?.();
                      }}
                      className={cn(
                        'flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm transition-colors duration-150',
                        active
                          ? 'bg-ink font-medium text-paper'
                          : 'text-ink hover:bg-ink/5',
                        locked && 'pointer-events-none opacity-50',
                      )}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {footer ? <div className="shrink-0 border-t border-line p-3">{footer}</div> : null}
    </aside>
  );
}
