'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function AdminShell({ title, children }: { title?: string; children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // The open state is only reachable through the lg:hidden toggle, so this
  // effect manages the mobile drawer: move focus in, trap Tab, restore on close.
  useEffect(() => {
    if (!sidebarOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sidebar = document.getElementById('admin-sidebar');
    const focusables = () =>
      Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (sidebar && (active === null || !sidebar.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [sidebarOpen]);

  return (
    <div className="min-h-dvh">
      {sidebarOpen ? (
        <div
          data-testid="sidebar-backdrop"
          aria-hidden
          className="fixed inset-0 z-20 bg-ink/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      <div className="lg:ms-64">
        <Topbar
          title={title}
          menuOpen={sidebarOpen}
          onMenuToggle={() => setSidebarOpen((open) => !open)}
        />
        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
