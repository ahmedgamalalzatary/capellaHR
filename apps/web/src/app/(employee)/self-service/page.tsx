import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SelfServiceEntry } from '@/features/employee-self-service';

export const metadata: Metadata = { title: 'الخدمة الذاتية' };

export default function SelfServicePage() {
  if (process.env.EDITION === 'erp') redirect('/branch-kiosk');
  return <SelfServiceEntry />;
}
