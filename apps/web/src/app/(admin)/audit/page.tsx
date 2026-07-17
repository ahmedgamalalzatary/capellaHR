import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'سجل المراجعة' };

export default function AuditPage() {
  return (
    <div className="text-sm text-muted">
      وحدة «سجل المراجعة» قيد الإنشاء.
    </div>
  );
}
