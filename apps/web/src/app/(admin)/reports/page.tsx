import type { Metadata } from 'next';

import { ReportsView } from '@/features/reports';
import { ProtectedAreaGate } from '@/features/protected-area';

export const metadata: Metadata = { title: 'التقارير' };

export default function ReportsPage() {
  return <ProtectedAreaGate area="reports"><ReportsView /></ProtectedAreaGate>;
}
