import type { ReactNode } from 'react';

import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-dvh">
      <Sidebar />
      <div className="me-64">
        <Topbar />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
