import type { Metadata } from 'next';

import { CatalogView } from '@/features/catalog';

export const metadata: Metadata = { title: 'الكتالوج' };

export default function CatalogPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">التصنيفات والخدمات</h2>
      <CatalogView />
    </div>
  );
}
