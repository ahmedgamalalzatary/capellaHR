import type { ReactNode } from 'react';

import { RequireErpAccount } from '@/features/auth';

export default function ProductsLayout({ children }: { children: ReactNode }) {
  return <RequireErpAccount role="admin">{children}</RequireErpAccount>;
}
