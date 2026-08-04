import type { Metadata } from 'next';

import { SalesView } from '@/features/sales';

export const metadata: Metadata = { title: 'بيع جديد' };

export default function SalesPage() {
  return <SalesView />;
}
