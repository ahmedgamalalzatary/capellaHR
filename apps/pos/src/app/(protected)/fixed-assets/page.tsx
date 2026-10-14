import type { Metadata } from 'next';

import { FixedAssetsView } from '@/features/fixed-assets';
import { RequireErpAccount } from '@/features/auth';

export const metadata: Metadata = { title: 'الأصول الثابتة' };

export default function FixedAssetsPage() {
  return <RequireErpAccount role="admin"><FixedAssetsView /></RequireErpAccount>;
}
