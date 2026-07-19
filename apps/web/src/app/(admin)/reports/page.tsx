import type { Metadata } from 'next';

import { ReportsView } from '@/features/reports';

export const metadata: Metadata = { title: 'التقارير' };

export default function ReportsPage() {
  return <ReportsView />;
}
