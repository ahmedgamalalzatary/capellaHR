import type { Metadata } from 'next';

import { AuditView } from '@/features/audit';

export const metadata: Metadata = { title: 'سجل المراجعة' };

export default function AuditPage() {
  return <AuditView />;
}
