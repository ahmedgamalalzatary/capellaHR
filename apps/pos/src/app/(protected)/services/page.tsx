import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/page-header';
import { ServicePicker } from '@/features/catalog';

export const metadata: Metadata = { title: 'الخدمات' };

/**
 * Counter-side browsing of the sellable catalog. An Admin belongs to no branch,
 * so this page is the Cashier's view; Admins manage the catalog under /catalog.
 */
export default function ServicesPage() {
  return (
    <section className="space-y-6">
      <PageHeader title="الخدمات" description="تصفّح الخدمات المتاحة للبيع وأسعارها الثابتة." />
      <ServicePicker />
    </section>
  );
}
