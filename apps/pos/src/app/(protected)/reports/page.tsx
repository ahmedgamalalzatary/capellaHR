import type { Metadata } from 'next';

import { ErpReportsView } from '@/features/erp-reports';

export const metadata: Metadata = { title: 'التقارير' };

export default function ReportsPage() {
  return <div className="space-y-4">
    <div>
      <h1 className="text-xl font-bold">التقارير</h1>
      <p className="text-sm text-muted">
        تقارير مالية وتشغيلية حسب الفرع والفترة مع تصدير PDF عربي.
      </p>
    </div>
    <ErpReportsView />
  </div>;
}
