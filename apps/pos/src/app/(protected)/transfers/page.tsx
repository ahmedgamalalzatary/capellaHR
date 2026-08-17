import type { Metadata } from 'next';

import { StockTransfersView } from '@/features/stock-transfers';

export const metadata: Metadata = { title: 'تحويل المنتجات' };

export default function TransfersPage() {
  return <StockTransfersView />;
}
