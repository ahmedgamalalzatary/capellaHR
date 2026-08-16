import type { ReactNode } from 'react';

import { RequireErpAccount } from '@/features/auth';

/** Shift oversight watches the cashiers; a cashier opens their own shift on the home screen. */
export default function CashierSessionsLayout({ children }: { children: ReactNode }) {
  return <RequireErpAccount role="admin">{children}</RequireErpAccount>;
}
