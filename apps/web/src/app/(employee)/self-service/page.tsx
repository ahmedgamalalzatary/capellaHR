import type { Metadata } from 'next';

import { SelfServiceEntry } from '@/features/employee-self-service';

export const metadata: Metadata = { title: 'الخدمة الذاتية' };

export default function SelfServicePage() {
  return <SelfServiceEntry />;
}
