import type { Metadata } from 'next';

import { ClientsView } from '@/features/clients';

export const metadata: Metadata = { title: 'العملاء' };

export default function ClientsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">العملاء</h2>
      <ClientsView />
    </div>
  );
}
