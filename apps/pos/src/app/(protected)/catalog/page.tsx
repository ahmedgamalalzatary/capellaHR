import type { Metadata } from 'next';

import { CatalogView } from '@/features/catalog';

export const metadata: Metadata = { title: 'الكتالوج' };

export default function CatalogPage() {
  return <CatalogView />;
}
