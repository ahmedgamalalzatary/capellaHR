'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@capella/ui';

import { ADMIN_NAV } from './nav';

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 start-0 z-30 flex w-64 flex-col border-e border-line bg-paper">
      <div className="flex h-14 items-center border-b border-line px-5">
        <span className="text-lg font-bold tracking-tight">كابيلا</span>
        <span className="ms-2 text-[12px] text-muted">الموارد البشرية</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {ADMIN_NAV.map((group, groupIndex) => (
          <div key={group.label ?? groupIndex} className="mb-4">
            {group.label ? (
              <p className="mb-1 px-2 text-[11px] font-semibold text-muted">{group.label}</p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-control px-2 py-1.5 text-sm transition-colors duration-150',
                        active ? 'bg-ink font-medium text-paper' : 'text-ink hover:bg-ink/5',
                      )}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
