import type { ReactNode } from 'react';

import { RequireAdmin } from '@/features/auth';
import { AdminShell } from '@/components/shell/admin-shell';

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <RequireAdmin>
      <AdminShell>{children}</AdminShell>
    </RequireAdmin>
  );
}
