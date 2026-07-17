import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'الفروع' };

export default function BranchesPage() {
  return (
    <div className="text-sm text-muted">
      وحدة «الفروع» قيد الإنشاء.
    </div>
  );
}
