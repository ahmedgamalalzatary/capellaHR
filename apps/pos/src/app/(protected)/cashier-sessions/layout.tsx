import type { ReactNode } from 'react';

import { RequireErpAccount } from '@/features/auth';

/** The API limits cashiers to their own history; admins retain branch-wide oversight. */
export default function CashierSessionsLayout({ children }: { children: ReactNode }) {
  return <RequireErpAccount>{children}</RequireErpAccount>;
}
