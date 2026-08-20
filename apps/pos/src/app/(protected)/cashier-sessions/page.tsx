import type { Metadata } from 'next';

import { CashierSessionView } from '@/features/cashier-sessions';

export const metadata: Metadata = { title: 'ورديات الكاشير والسجل' };

export default function CashierSessionsPage() {
  return <CashierSessionView />;
}
