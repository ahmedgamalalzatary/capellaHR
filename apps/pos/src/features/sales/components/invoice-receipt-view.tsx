'use client';

import type { PaymentMethod, PublicInvoiceDto, RefundQuote } from '@capella/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

import { Button, Card, CardContent, EmptyState } from '@capella/ui';

import { useSession } from '@/features/auth';
import {
  createErpReportExport,
  downloadErpReportExport,
  getErpReportExport,
  listErpReportExports,
  retryErpReportExport,
  type ErpReportExport,
} from '@/features/erp-reports';
import { createUuid } from '@/lib/uuid';

import { getInvoice, quoteRefund, refundInvoice, voidInvoice } from '../api/sales-api';
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

const cents = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

function ReversalControls({
  invoice,
  branchId,
  onUpdated,
}: {
  invoice: PublicInvoiceDto;
  branchId?: number;
  onUpdated(invoice: PublicInvoiceDto): void;
}) {
  const [mode, setMode] = useState<'refund' | 'void' | null>(null);
  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [paymentAmounts, setPaymentAmounts] = useState<Record<PaymentMethod, string>>({
    cash: '', visa: '', instapay: '', vodafone_cash: '',
  });
  const [quoted, setQuoted] = useState<RefundQuote | null>(null);
  const commandIdentity = useRef<{ fingerprint: string; key: string } | null>(null);
  const idempotencyKeyFor = (payload: unknown) => {
    const fingerprint = JSON.stringify(payload);
    if (commandIdentity.current?.fingerprint !== fingerprint) {
      commandIdentity.current = { fingerprint, key: createUuid() };
    }
    return commandIdentity.current.key;
  };
  const selectedLines = invoice.lines.flatMap((line) => {
    const quantity = Number(quantities[line.id] ?? 0);
    return Number.isInteger(quantity) && quantity > 0 && quantity <= line.refundableQuantity
      ? [{ invoiceLineId: line.id, quantity }]
      : [];
  });
  const hasInvalidQuantity = invoice.lines.some((line) => {
    const raw = quantities[line.id];
    if (raw === undefined || raw === '') return false;
    const quantity = Number(raw);
    return quantity !== 0 && (!Number.isInteger(quantity)
      || quantity < 0 || quantity > line.refundableQuantity);
  });
  const quote = useMutation({
    mutationFn: () => quoteRefund(invoice.id, {
      ...(branchId === undefined ? {} : { branchId }), lines: selectedLines,
    }),
    onSuccess: (value) => {
      setQuoted(value);
      setPaymentAmounts({ cash: '', visa: '', instapay: '', vodafone_cash: '' });
    },
  });
  const refund = useMutation({
    mutationFn: () => {
      const payload = {
        ...(branchId === undefined ? {} : { branchId }),
        reason: reason.trim(),
        lines: selectedLines,
        payments: quoted!.payments.flatMap((payment) => {
          const amount = paymentAmounts[payment.method].trim();
          return cents(amount) && cents(amount)! > BigInt(0) ? [{ method: payment.method, amount }] : [];
        }),
      };
      return refundInvoice(invoice.id, {
        ...payload,
        idempotencyKey: idempotencyKeyFor(payload),
      });
    },
    onSuccess: (value) => { onUpdated(value); close(true); },
  });
  const voidMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...(branchId === undefined ? {} : { branchId }),
        reason: reason.trim(),
      };
      return voidInvoice(invoice.id, {
        ...payload,
        idempotencyKey: idempotencyKeyFor(payload),
      });
    },
    onSuccess: (value) => { onUpdated(value); close(true); },
  });
  const reversalPending = refund.isPending || voidMutation.isPending;
  function close(requestSettled = false) {
    if (reversalPending && !requestSettled) return;
    setMode(null);
    setReason('');
    setQuantities({});
    setPaymentAmounts({ cash: '', visa: '', instapay: '', vodafone_cash: '' });
    setQuoted(null);
    commandIdentity.current = null;
    quote.reset();
    refund.reset();
    voidMutation.reset();
  }
  function openMode(nextMode: 'refund' | 'void') {
    if (reversalPending) return;
    close();
    setMode(nextMode);
  }
  const tenderTotal = quoted?.payments.reduce(
    (sum, payment) => sum + (cents(paymentAmounts[payment.method].trim()) ?? BigInt(0)), BigInt(0),
  ) ?? BigInt(0);
  const tenderValid = quoted !== null
    && tenderTotal === cents(quoted.totals.total)
    && quoted.payments.every((payment) => (
      (cents(paymentAmounts[payment.method].trim()) ?? BigInt(0)) <= cents(payment.refundableAmount)!
    ));
  const error = quote.error ?? refund.error ?? voidMutation.error;

  return <div data-print-controls className="mx-auto max-w-3xl space-y-3">
    <div className="flex flex-wrap gap-2">
      {invoice.eligibility.canRefund ? <Button variant="secondary" disabled={reversalPending} onClick={() => openMode('refund')}>استرداد</Button> : null}
      {invoice.eligibility.canVoid ? <Button variant="secondary" disabled={reversalPending} onClick={() => openMode('void')}>إلغاء الفاتورة</Button> : null}
    </div>
    {mode === 'refund' ? <Card><CardContent className="space-y-4 pt-5">
      <h2 className="text-lg font-semibold">استرداد جزئي أو كامل</h2>
      <div className="space-y-2">{invoice.lines.filter((line) => line.refundableQuantity > 0).map((line) => <label key={line.id} className="grid gap-1 sm:grid-cols-[1fr_8rem] sm:items-center">
        <span>{line.name} · متبقي {line.refundableQuantity}</span>
        <input aria-label={`كمية استرداد ${line.name}`} type="number" min={0} max={line.refundableQuantity} disabled={quote.isPending} className="rounded-control border border-line bg-paper px-3 py-2" value={quantities[line.id] ?? ''} onChange={(event) => { setQuantities((current) => ({ ...current, [line.id]: event.target.value })); setQuoted(null); }} />
      </label>)}</div>
      <Button disabled={!selectedLines.length || hasInvalidQuantity || quote.isPending} onClick={() => quote.mutate()}>{quote.isPending ? 'جارٍ الحساب…' : 'احسب الاسترداد'}</Button>
      {quoted ? <div className="space-y-3 rounded-control border border-line p-3">
        <p className="font-semibold">الإجمالي المسترد: <span dir="ltr">{quoted.totals.total} ج.م</span></p>
        {quoted.payments.map((payment) => <label key={payment.method} className="grid gap-1 sm:grid-cols-[1fr_10rem] sm:items-center">
          <span>{paymentLabels[payment.method]} · متاح {payment.refundableAmount} ج.م</span>
          <input aria-label={`مبلغ الاسترداد ${paymentLabels[payment.method]}`} inputMode="decimal" className="rounded-control border border-line bg-paper px-3 py-2" value={paymentAmounts[payment.method]} onChange={(event) => setPaymentAmounts((current) => ({ ...current, [payment.method]: event.target.value }))} />
        </label>)}
        <label className="grid gap-1"><span>سبب الاسترداد</span><textarea aria-label="سبب الاسترداد" maxLength={1000} className="rounded-control border border-line bg-paper px-3 py-2" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="flex gap-2"><Button disabled={!reason.trim() || !tenderValid || refund.isPending} onClick={() => refund.mutate()}>{refund.isPending ? 'جارٍ الاسترداد…' : 'تأكيد الاسترداد'}</Button><Button variant="ghost" disabled={reversalPending} onClick={() => close()}>رجوع</Button></div>
      </div> : null}
    </CardContent></Card> : null}
    {mode === 'void' ? <Card><CardContent className="space-y-3 pt-5">
      <h2 className="text-lg font-semibold">إلغاء الفاتورة بالكامل</h2>
      <p className="text-sm text-muted">سيتم عكس كل البنود والمدفوعات والمخزون والعمولة.</p>
      <label className="grid gap-1"><span>سبب الإلغاء</span><textarea aria-label="سبب الإلغاء" maxLength={1000} className="rounded-control border border-line bg-paper px-3 py-2" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="flex gap-2"><Button disabled={!reason.trim() || voidMutation.isPending} onClick={() => voidMutation.mutate()}>{voidMutation.isPending ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}</Button><Button variant="ghost" disabled={reversalPending} onClick={() => close()}>رجوع</Button></div>
    </CardContent></Card> : null}
    {error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-danger">{responseMessage(error)}</p> : null}
    {invoice.reversals.length ? <Card><CardContent className="space-y-3 pt-5"><h2 className="text-lg font-semibold">سجل الإلغاء والاسترداد</h2>{invoice.reversals.map((reversal) => <div key={reversal.id} className="space-y-2 border-t border-line pt-3 first:border-0 first:pt-0"><p className="font-medium">{reversal.type === 'void' ? 'إلغاء كامل' : 'استرداد'} · {reversal.totals.total} ج.م</p><p className="text-sm">{reversal.reason}</p><ul className="text-sm">{reversal.lines.map((line) => <li key={line.invoiceLineId}>{line.name} × {line.quantity} · {line.total} ج.م</li>)}</ul>{reversal.payments.length ? <ul className="text-sm">{reversal.payments.map((payment) => <li key={payment.method}>{paymentLabels[payment.method]} · {payment.amount} ج.م</li>)}</ul> : <p className="text-sm">لا توجد حركة دفع لهذا الاسترداد</p>}<p className="text-xs text-muted">{reversal.actingAccount.username} · {formatCairoDateTime(reversal.createdAt)}</p></div>)}</CardContent></Card> : null}
  </div>;
}

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
          <div key={payment.method} className="space-y-1">
            <div className="flex justify-between"><span>{paymentLabels[payment.method]}</span><span>{payment.amount} ج.م</span></div>
            <p className="text-xs text-muted">تم استرداد {payment.refundedAmount} ج.م · متبقي {payment.refundableAmount} ج.م</p>
          </div>
        ))}
      </div>
      <p className="border-t border-dashed border-ink pt-3 text-center">شكرًا لزيارتكم</p>
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
    <div data-print-controls className="mx-auto flex max-w-[80mm] flex-wrap items-center justify-between gap-2">
      <Link href={branchId ? `/invoices?branchId=${branchId}` : '/invoices'}>العودة إلى الفواتير</Link>
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
        <Button onClick={print}><Printer className="size-4" />طباعة الإيصال</Button>
      </span>
    </div>
    {createExport.isError || exportQuery.isError || retryExport.isError || downloadExport.isError
      ? <p role="alert" data-print-controls className="mx-auto max-w-[80mm] rounded-control bg-danger-soft p-3 text-danger">تعذر إكمال تصدير PDF. حاول مرة أخرى.</p>
      : null}
    {printError ? <p role="alert" data-print-controls className="mx-auto max-w-[80mm] rounded-control bg-danger-soft p-3 text-danger">{printError}</p> : null}
    <Card className="mx-auto max-w-[84mm]"><CardContent className="p-0"><Receipt invoice={query.data} /></CardContent></Card>
    <ReversalControls invoice={query.data} {...(branchId === undefined ? {} : { branchId })} onUpdated={(invoice) => {
      queryClient.setQueryData(salesQueryKeys.invoice(invoiceId, branchId), invoice);
      void queryClient.invalidateQueries({ queryKey: salesQueryKeys.all });
    }} />
  </section>;
}
