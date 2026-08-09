import type { Metadata } from 'next';

import { CommissionsView } from '@/features/commissions';

export const metadata: Metadata = { title: 'العمولات' };

export default function CommissionsPage() {
  return <div className="space-y-4">
    <div>
      <h1 className="text-xl font-bold">العمولات</h1>
      <p className="text-sm text-muted">إجماليات شهرية قابلة للتتبع حتى بند الفاتورة وعملية العكس.</p>
    </div>
    <CommissionsView />
  </div>;
}
