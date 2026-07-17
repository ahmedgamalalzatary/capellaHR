import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'الأجهزة' };

export default function DevicesPage() {
  return (
    <div className="text-sm text-muted">
      وحدة «الأجهزة» قيد الإنشاء.
    </div>
  );
}
