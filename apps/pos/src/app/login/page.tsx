import type { Metadata } from 'next';

import { LoginView } from '@/features/auth';

export const metadata: Metadata = { title: 'تسجيل الدخول' };

export default function LoginPage() {
  return <LoginView />;
}
