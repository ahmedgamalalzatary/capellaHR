import type { Metadata } from 'next';

import { CashierAccountsView } from '@/features/cashier-accounts';

export const metadata: Metadata = { title: 'حسابات الكاشير' };

export default function CashierAccountsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">حسابات الكاشير</h2>
      <CashierAccountsView />
    </div>
  );
}
