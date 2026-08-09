import type { Metadata } from 'next';

import { ServicePicker } from '@/features/catalog';

export const metadata: Metadata = { title: 'الخدمات' };

/**
 * Counter-side browsing of the sellable catalog. An Admin belongs to no branch,
 * so this page is the Cashier's view; Admins manage the catalog under /catalog.
 */
export default function ServicesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink">الخدمات</h1>
      <ServicePicker />
    </div>
  );
}
