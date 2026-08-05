'use client';

import type { PaymentMethod, PublicInvoiceDto } from '@capella/contracts';
import { useQuery } from '@tanstack/react-query';
import { Printer, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button, Card, CardContent, EmptyState } from '@capella/ui';

import { getInvoice } from '../api/sales-api';
import { salesQueryKeys } from '../query-keys';

const paymentLabels: Record<PaymentMethod, string> = {
  cash: 'نقدي',
  visa: 'فيزا',
  instapay: 'إنستا باي',
  vodafone_cash: 'فودافون كاش',
};

const formatCairoDateTime = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo',
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

const requestReference = (error: unknown) => {
  const requestId = typeof error === 'object' && error !== null
    ? Reflect.get(error, 'requestId')
    : undefined;
  return typeof requestId === 'string' ? requestId : null;
};

const responseMessage = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return 'تعذر تحميل الفاتورة.';
  const status = Reflect.get(error, 'status');
  const message = Reflect.get(error, 'message');
  return typeof status === 'number' && typeof message === 'string' && message.length > 0
    ? message
    : 'تعذر تحميل الفاتورة.';
};

function Receipt({ invoice }: { invoice: PublicInvoiceDto }) {
  return (
    <article data-receipt className="mx-auto w-full max-w-[80mm] bg-paper p-4 text-sm text-ink">
      <header className="border-b border-dashed border-ink pb-3 text-center">
        <h1 className="text-lg font-bold">كابيلا</h1>
        <p>إيصال بيع</p>
        <p className="mt-2 font-mono text-xs" dir="ltr">{invoice.invoiceNumber}</p>
        <time dateTime={invoice.soldAt}>{formatCairoDateTime(invoice.soldAt)}</time>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 border-b border-dashed border-ink py-3">
        <dt>العميل:</dt><dd>{invoice.client.name}</dd>
        <dt>الهاتف:</dt><dd dir="ltr" className="text-end">{invoice.client.phone}</dd>
        <dt>الموظف:</dt><dd>{invoice.assignedEmployee.name}</dd>
        <dt>بواسطة:</dt><dd>{invoice.authorizedBy.username}</dd>
      </dl>
      <div className="border-b border-dashed border-ink py-3">
        {invoice.lines.map((line) => (
          <div key={line.id} className="mb-2 grid grid-cols-[1fr_auto] gap-2 last:mb-0">
            <span>{line.name} × {line.quantity}</span>
            <span className="tabular" dir="ltr">{line.lineTotal} ج.م</span>
            <span className="text-xs text-muted">{line.unitPrice} ج.م للوحدة</span>
          </div>
        ))}
      </div>
      <dl className="space-y-1 border-b border-dashed border-ink py-3">
        <div className="flex justify-between"><dt>المجموع الفرعي</dt><dd>{invoice.totals.subtotal} ج.م</dd></div>
        {invoice.discount ? <div className="flex justify-between"><dt>الخصم</dt><dd>- {invoice.discount.amount} ج.م</dd></div> : null}
        {invoice.tax ? <div className="flex justify-between"><dt>الضريبة</dt><dd>+ {invoice.tax.amount} ج.م</dd></div> : null}
        <div className="flex justify-between text-base font-bold"><dt>الإجمالي</dt><dd>{invoice.totals.total} ج.م</dd></div>
      </dl>
      <div className="py-3">
        <h2 className="font-semibold">المدفوعات</h2>
        {invoice.payments.map((payment) => (
          <div key={payment.method} className="flex justify-between">
            <span>{paymentLabels[payment.method]}</span><span>{payment.amount} ج.م</span>
          </div>
        ))}
      </div>
      <p className="border-t border-dashed border-ink pt-3 text-center">شكرًا لزيارتكم</p>
    </article>
  );
}

export function InvoiceReceiptView({ invoiceId, branchId }: { invoiceId: number; branchId?: number }) {
  const [printError, setPrintError] = useState<string | null>(null);
  const validBranch = branchId === undefined || (Number.isInteger(branchId) && branchId > 0);
  const query = useQuery({
    queryKey: salesQueryKeys.invoice(invoiceId, branchId),
    queryFn: () => getInvoice(invoiceId, branchId),
    enabled: Number.isInteger(invoiceId) && invoiceId > 0 && validBranch,
    retry: false,
  });

  if (!Number.isInteger(invoiceId) || invoiceId < 1 || !validBranch) {
    return <EmptyState title="رابط الفاتورة غير صالح" description="ارجع إلى سجل الفواتير واختر فاتورة صحيحة." />;
  }
  if (query.isPending) return <p role="status">جارٍ تحميل الفاتورة…</p>;
  if (query.isError) {
    const reference = requestReference(query.error);
    return <div role="alert" className="space-y-3 rounded-control bg-danger-soft p-4 text-danger">
      <p>{responseMessage(query.error)}</p>
      {reference ? <p className="text-xs">مرجع الطلب: {reference}</p> : null}
      <Button variant="secondary" onClick={() => void query.refetch()}><RotateCcw className="size-4" />إعادة المحاولة</Button>
    </div>;
  }

  const print = () => {
    setPrintError(null);
    if (typeof window.print !== 'function') {
      setPrintError('الطباعة غير متاحة في هذا المتصفح. استخدم متصفحًا يدعم الطباعة.');
      return;
    }
    try {
      window.print();
    } catch {
      setPrintError('تعذر فتح نافذة الطباعة. تحقق من إعدادات المتصفح والطابعة ثم حاول مرة أخرى.');
    }
  };

  return <section className="space-y-4">
    <div data-print-controls className="mx-auto flex max-w-[80mm] flex-wrap justify-between gap-2">
      <Link href={branchId ? `/invoices?branchId=${branchId}` : '/invoices'}>العودة إلى الفواتير</Link>
      <Button onClick={print}><Printer className="size-4" />طباعة الإيصال</Button>
    </div>
    {printError ? <p role="alert" data-print-controls className="mx-auto max-w-[80mm] rounded-control bg-danger-soft p-3 text-danger">{printError}</p> : null}
    <Card className="mx-auto max-w-[84mm]"><CardContent className="p-0"><Receipt invoice={query.data} /></CardContent></Card>
  </section>;
}
