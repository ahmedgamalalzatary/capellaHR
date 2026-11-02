import type { ReactNode } from 'react';

import { RequireErpAccount } from '@/features/auth';

import { PosShell } from '@/components/shell/pos-shell';
import { ReceptionGate } from '@/components/shell/reception-gate';

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <RequireErpAccount reception>
      <PosShell>
        <ReceptionGate>{children}</ReceptionGate>
      </PosShell>
    </RequireErpAccount>
  );
}
