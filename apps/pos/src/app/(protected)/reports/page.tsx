import type { Metadata } from 'next';

import { ErpReportsView } from '@/features/erp-reports';

export const metadata: Metadata = { title: 'التقارير' };

export default function ReportsPage() {
  return <ErpReportsView />;
}
