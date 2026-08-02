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
      <h2 className="text-lg font-bold">الخدمات</h2>
      <ServicePicker />
    </div>
  );
}
