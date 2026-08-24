'use client';

import type { PaymentMethod, PublicInvoiceDto } from '@capella/contracts';

import { RECEIPT_PAGE_RULE } from '@/lib/print/hardware';
import { PrintPageRule } from '@/lib/print/page-rule';

import { paymentLabels } from './invoice-format';

export function PaymentReceipt({
  invoice,
  method,
  amount,
  operationReference,
}: {
  invoice: PublicInvoiceDto;
  method: PaymentMethod;
  amount: string;
  operationReference: string;
}) {
  return <article data-payment-receipt data-receipt className="mx-auto w-full max-w-[80mm] bg-paper p-4 text-sm text-ink">
    <PrintPageRule rule={RECEIPT_PAGE_RULE} />
    <header className="border-b border-dashed border-ink pb-3">
      <p className="font-serif text-2xl italic leading-none">Capella Care</p>
      <h1 className="mt-1.5 text-lg font-bold">إيصال دفعة</h1>
    </header>
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 py-3">
      <dt>رقم الفاتورة</dt><dd className="font-mono text-xs">{invoice.invoiceNumber}</dd>
      <dt>طريقة الدفع</dt><dd>{paymentLabels[method]}</dd>
      <dt>المبلغ</dt><dd className="font-bold tabular">{amount} ج.م</dd>
      <dt>الرصيد المتبقي</dt><dd className="font-bold tabular">{invoice.totals.balanceDue} ج.م</dd>
      <dt>مرجع العملية</dt><dd className="break-all font-mono text-[10px]">{operationReference}</dd>
    </dl>
  </article>;
}
