import type { ReactNode } from 'react';

import { RequireErpAccount } from '@/features/auth';

import { PosShell } from '@/components/shell/pos-shell';

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <RequireErpAccount>
      <PosShell>{children}</PosShell>
    </RequireErpAccount>
  );
}
