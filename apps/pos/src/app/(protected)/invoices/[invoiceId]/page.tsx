import type { Metadata } from 'next';

import { InvoiceReceiptView } from '@/features/sales';

export const metadata: Metadata = { title: 'تفاصيل الفاتورة' };

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ branchId?: string }>;
}) {
  const [{ invoiceId }, query] = await Promise.all([params, searchParams]);
  const branchId = query.branchId ? Number(query.branchId) : undefined;
  return <InvoiceReceiptView
    invoiceId={Number(invoiceId)}
    {...(branchId === undefined ? {} : { branchId })}
  />;
}
