import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'الإعدادات' };

export default function SettingsPage() {
  return (
    <div className="text-sm text-muted">
      وحدة «الإعدادات» قيد الإنشاء.
    </div>
  );
}
