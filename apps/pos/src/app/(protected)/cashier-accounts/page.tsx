import type { Metadata } from 'next';

import { CashierAccountsView } from '@/features/cashier-accounts';

export const metadata: Metadata = { title: 'حسابات الكاشير' };

export default function CashierAccountsPage() {
  return <CashierAccountsView />;
}
