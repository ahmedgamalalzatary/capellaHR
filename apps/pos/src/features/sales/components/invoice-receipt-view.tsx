'use client';

import type { PublicInvoiceDto } from '@capella/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Printer, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { Button, Card, CardContent, EmptyState } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { useSession } from '@/features/auth';
import {
  createErpReportExport,
  downloadErpReportExport,
  getErpReportExport,
  listErpReportExports,
  retryErpReportExport,
  type ErpReportExport,
} from '@/features/erp-reports';

import { getInvoice } from '../api/sales-api';
import { salesQueryKeys } from '../query-keys';
import { formatCairoDateTime, paymentLabels, requestReference, responseMessage } from './invoice-format';
import { InvoiceReversalControls } from './invoice-reversal-controls';
import { invalidateErpCaches } from '@/lib/erp-cache';

function ReceiptQr({ value }: { value: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: 'svg', margin: 1, width: 144 })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setSvg('');
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div
      data-testid="receipt-qr"
      className="w-14 shrink-0 [&_svg]:h-auto [&_svg]:w-full"
      // qrcode emits a self-contained inline SVG built only from our own invoice number.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function Receipt({ invoice }: { invoice: PublicInvoiceDto }) {
  const totalQuantity = invoice.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <article data-receipt className="mx-auto w-full max-w-[80mm] bg-paper p-4 text-sm text-ink">
      <header className="flex items-start justify-between gap-3 border-b border-dashed border-ink pb-3">
        <div>
          <p className="font-serif text-2xl italic leading-none">Capella</p>
          <h1 className="mt-1.5 text-lg font-bold">كابيلا</h1>
          <p className="text-xs text-muted">إيصال بيع</p>
        </div>
        <ReceiptQr value={invoice.invoiceNumber} />
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 border-b border-dashed border-ink py-3">
        <dt>رقم الفاتورة</dt><dd className="font-mono text-xs" dir="ltr">{invoice.invoiceNumber}</dd>
        <dt>التاريخ</dt><dd><time dateTime={invoice.soldAt}>{formatCairoDateTime(invoice.soldAt)}</time></dd>
        <dt>العميل</dt><dd>{invoice.client.name}</dd>
        <dt>الهاتف</dt><dd dir="ltr" className="text-end">{invoice.client.phone}</dd>
        <dt>الموظف</dt><dd>{invoice.assignedEmployee?.name ?? 'بدون موظف'}</dd>
        {invoice.seller
          ? <dt>الكاشير</dt>
          : <dt>بواسطة</dt>}
        <dd>{invoice.seller?.name ?? invoice.authorizedBy.username}</dd>
      </dl>
      <table className="mt-3 w-full border-collapse text-xs">
        <thead>
          <tr className="bg-surface">
            <th scope="col" className="border border-line px-1.5 py-1.5 text-start font-medium">الصنف</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">السعر</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">الكمية</th>
            <th scope="col" className="border border-line px-1 py-1.5 font-medium">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td className="border border-line px-1.5 py-1.5 text-start">{line.name}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular" dir="ltr">{line.unitPrice}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular" dir="ltr">{line.quantity}</td>
              <td className="border border-line px-1 py-1.5 text-center tabular" dir="ltr">{line.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1 border-b border-dashed border-ink py-3 text-xs">
        <div className="flex justify-between text-muted">
          <span>عدد الأصناف</span>
          <span className="tabular" dir="ltr">{invoice.lines.length}</span>
        </div>
        <div className="flex justify-between text-muted">
          <span>إجمالي الكميات</span>
          <span className="tabular" dir="ltr">{totalQuantity}</span>
        </div>
        <div className="flex justify-between">
          <span>المجموع الفرعي</span>
          <span className="tabular" dir="ltr">{invoice.totals.subtotal} ج.م</span>
        </div>
        {invoice.discount ? (
          <div className="flex justify-between">
            <span>الخصم</span>
            <span className="tabular" dir="ltr">- {invoice.discount.amount} ج.م</span>
          </div>
        ) : null}
        {invoice.tax ? (
          <div className="flex justify-between">
            <span>الضريبة</span>
            <span className="tabular" dir="ltr">+ {invoice.tax.amount} ج.م</span>
          </div>
        ) : null}
        <div data-grand-total className="mt-1.5 flex items-baseline justify-between border-y-2 border-ink py-1.5 text-sm font-bold">
          <span>الإجمالي النهائي</span>
          <span className="tabular" dir="ltr">{invoice.totals.total} ج.م</span>
        </div>
      </div>
      <div className="border-b border-dashed border-ink py-3">
        <h2 className="text-sm font-semibold">المدفوعات</h2>
        <div className="mt-1.5 space-y-1.5 text-xs">
          {invoice.payments.map((payment) => (
            <div key={payment.method} className="flex justify-between">
              <span>{paymentLabels[payment.method]}</span>
              <span className="tabular" dir="ltr">{payment.amount} ج.م</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-dashed border-line pt-1.5 font-bold">
            <span>المدفوع</span>
            <span className="tabular" dir="ltr">{invoice.totals.paymentTotal} ج.م</span>
          </div>
        </div>
      </div>
      <footer className="pt-3 text-center">
        <p>شكرًا لزيارتكم</p>
        <p className="mt-1 text-xs text-muted">Capella · كابيلا</p>
      </footer>
    </article>
  );
}

export function InvoiceReceiptView({ invoiceId, branchId }: { invoiceId: number; branchId?: number }) {
  const [printError, setPrintError] = useState<string | null>(null);
  const [exportId, setExportId] = useState<number>();
  const queryClient = useQueryClient();
  const session = useSession();
  const isAdmin = session.data?.actor.type === 'admin';
  const validBranch = branchId === undefined || (Number.isInteger(branchId) && branchId > 0);
  const query = useQuery({
    queryKey: salesQueryKeys.invoice(invoiceId, branchId),
    queryFn: () => getInvoice(invoiceId, branchId),
    enabled: Number.isInteger(invoiceId) && invoiceId > 0 && validBranch,
    retry: false,
  });
  const existingExport = useQuery({
    queryKey: ['erp-reports', 'invoice-export', invoiceId],
    queryFn: async () => {
      const result = await listErpReportExports({
        reportType: 'erp-invoice', page: 1, pageSize: 100,
      });
      let newest: ErpReportExport | null = null;
      for (const record of result.items) {
        const eligible = record.selection.mode === 'selected'
          && record.selection.ids.includes(invoiceId)
          && !(record.status === 'completed' && record.fileDeletedAt);
        if (!eligible) continue;
        if (!newest || record.createdAt > newest.createdAt
          || (record.createdAt === newest.createdAt && record.id > newest.id)) {
          newest = record;
        }
      }
      return newest;
    },
    enabled: isAdmin && Number.isInteger(invoiceId) && invoiceId > 0,
  });
  const activeExportId = exportId ?? existingExport.data?.id;
  const exportQuery = useQuery({
    queryKey: ['erp-reports', 'export', activeExportId],
    queryFn: () => getErpReportExport(activeExportId!),
    enabled: isAdmin && activeExportId !== undefined,
    refetchInterval: (result) => result.state.data?.status === 'queued'
      || result.state.data?.status === 'processing' ? 5_000 : false,
  });
  const createExport = useMutation({
    mutationFn: () => createErpReportExport({
      reportType: 'erp-invoice',
      filters: branchId === undefined ? {} : { branchId },
      selection: { mode: 'selected', ids: [invoiceId] },
    }),
    onSuccess: (record) => setExportId(record.id),
  });
  const retryExport = useMutation({
    mutationFn: () => retryErpReportExport(activeExportId!),
    onSuccess: (record) => queryClient.setQueryData(
      ['erp-reports', 'export', record.id], record,
    ),
  });
  const downloadExport = useMutation({
    mutationFn: () => downloadErpReportExport(activeExportId!),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${query.data?.invoiceNumber ?? `invoice-${invoiceId}`}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });

  if (!Number.isInteger(invoiceId) || invoiceId < 1 || !validBranch) {
    return <EmptyState title="رابط الفاتورة غير صالح" description="ارجع إلى سجل الفواتير واختر فاتورة صحيحة." />;
  }
  if (query.isPending) return <LoadingState label="جارٍ تحميل الفاتورة…" />;
  if (query.isError) {
    const reference = requestReference(query.error);
    return <div role="alert" className="mx-auto w-full max-w-2xl space-y-3 rounded-card border border-danger/20 bg-danger-soft p-5 text-danger">
      <p className="text-sm font-medium">{responseMessage(query.error, 'تعذر تحميل الفاتورة.')}</p>
      {reference ? <p className="text-xs">مرجع الطلب: {reference}</p> : null}
      <Button variant="secondary" onClick={() => void query.refetch()}><RotateCcw className="size-4" aria-hidden />إعادة المحاولة</Button>
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
    <div data-print-controls className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2">
      <Link
        href={branchId ? `/invoices?branchId=${branchId}` : '/invoices'}
        className="inline-flex h-9 items-center gap-1.5 rounded-control px-2 text-sm font-medium text-ink transition-colors hover:bg-surface"
      >
        <ArrowRight className="size-4" aria-hidden />
        العودة إلى الفواتير
      </Link>
      <span className="flex flex-wrap gap-2">
        {isAdmin ? existingExport.isError && activeExportId === undefined ? (
          <Button variant="secondary" onClick={() => void existingExport.refetch()}>
            إعادة تحميل سجل PDF
          </Button>
        ) : exportQuery.isError ? (
          <Button variant="secondary" onClick={() => void exportQuery.refetch()}>
            إعادة تحميل حالة PDF
          </Button>
        ) : exportQuery.data?.status === 'completed' && !exportQuery.data.fileDeletedAt ? (
          <Button variant="secondary" disabled={downloadExport.isPending} onClick={() => downloadExport.mutate()}>
            {downloadExport.isPending ? 'جارٍ التنزيل…' : 'تنزيل PDF A4'}
          </Button>
        ) : exportQuery.data?.status === 'failed' ? (
          <Button variant="secondary" disabled={retryExport.isPending} onClick={() => retryExport.mutate()}>
            {retryExport.isPending ? 'جارٍ إعادة المحاولة…' : 'إعادة محاولة PDF A4'}
          </Button>
        ) : activeExportId !== undefined ? (
          <Button variant="secondary" disabled>جارٍ إنشاء PDF A4…</Button>
        ) : existingExport.isPending ? (
          <Button variant="secondary" disabled>جارٍ التحقق من ملفات PDF…</Button>
        ) : (
          <Button variant="secondary" disabled={createExport.isPending} onClick={() => createExport.mutate()}>
            {createExport.isPending ? 'جارٍ وضع الطلب…' : 'إنشاء PDF A4'}
          </Button>
        ) : null}
        <Button onClick={print}><Printer className="size-4" aria-hidden />طباعة الإيصال</Button>
      </span>
    </div>
    {createExport.isError || exportQuery.isError || retryExport.isError || downloadExport.isError
      ? <p role="alert" data-print-controls className="mx-auto w-full max-w-2xl rounded-control border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">تعذر إكمال تصدير PDF. حاول مرة أخرى.</p>
      : null}
    {printError ? <p role="alert" data-print-controls className="mx-auto w-full max-w-2xl rounded-control border border-danger/20 bg-danger-soft p-3 text-[13px] text-danger">{printError}</p> : null}
    <Card className="mx-auto max-w-[84mm] shadow-raised"><CardContent className="p-0"><Receipt invoice={query.data} /></CardContent></Card>
    <InvoiceReversalControls invoice={query.data} showRefundAction={false} {...(branchId === undefined ? {} : { branchId })} onUpdated={(invoice) => {
      queryClient.setQueryData(salesQueryKeys.invoice(invoiceId, branchId), invoice);
      void invalidateErpCaches(queryClient, 'reversal');
    }} />
  </section>;
}
