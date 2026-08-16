import type { ReactNode } from 'react';

import { RequireErpAccount } from '@/features/auth';

export default function SuppliersLayout({ children }: { children: ReactNode }) {
  return <RequireErpAccount>{children}</RequireErpAccount>;
}
