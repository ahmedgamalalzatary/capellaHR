import type { Metadata } from 'next';

import { ClientsView } from '@/features/clients';

export const metadata: Metadata = { title: 'العملاء' };

export default function ClientsPage() {
  return <ClientsView />;
}
