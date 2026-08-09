import type { Metadata } from 'next';

import { CommissionsView } from '@/features/commissions';

export const metadata: Metadata = { title: 'العمولات' };

export default function CommissionsPage() {
  return <CommissionsView />;
}
