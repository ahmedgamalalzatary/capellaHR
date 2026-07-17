'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function AdminShell({ title, children }: { title?: string; children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
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
