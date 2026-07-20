import type { Metadata } from 'next';

import { DashboardView } from '@/features/dashboard';

export const metadata: Metadata = { title: 'الرئيسية' };

export default function DashboardPage() {
  return <DashboardView />;
}
