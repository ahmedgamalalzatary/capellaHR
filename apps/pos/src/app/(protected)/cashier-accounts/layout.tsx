import type { ReactNode } from 'react';

import { RequireErpAccount } from '@/features/auth';

export default function CashierAccountsLayout({ children }: { children: ReactNode }) {
  return <RequireErpAccount role="admin">{children}</RequireErpAccount>;
}
