import type { Metadata } from 'next';

import { DevicesView } from '@/features/devices';

export const metadata: Metadata = { title: 'الأجهزة' };

export default function DevicesPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">الأجهزة</h2>
      <DevicesView />
    </div>
  );
}
