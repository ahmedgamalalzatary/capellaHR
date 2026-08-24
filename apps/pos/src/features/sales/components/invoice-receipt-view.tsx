'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Printer, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button, Card, CardContent, EmptyState } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { useSession } from '@/features/auth';
import { getCurrentCashierSession } from '@/features/cashier-sessions';
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
import { requestReference, responseMessage } from './invoice-format';
import { InvoiceReversalControls } from './invoice-reversal-controls';
import { ReceiptBundle } from './receipt';
import { ReassignEmployeeDialog } from './reassign-employee-dialog';
import { RecordPaymentDialog } from './record-payment-dialog';
import { invalidateErpCaches } from '@/lib/erp-cache';

export function InvoiceReceiptView({ invoiceId, branchId }: { invoiceId: number; branchId?: number }) {
  const [printError, setPrintError] = useState<string | null>(null);
  const [exportId, setExportId] = useState<number>();
  const [reassignLineId, setReassignLineId] = useState<number | null>(null);
  const [recordingPayment, setRecordingPayment] = useState(false);
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
  const currentCashierSession = useQuery({
    queryKey: ['erp-sales', 'cashier-session', branchId ?? null],
    queryFn: () => getCurrentCashierSession(branchId),
    enabled: validBranch,
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
    <Card className="mx-auto max-w-[84mm] shadow-raised"><CardContent className="p-0"><ReceiptBundle invoice={query.data} /></CardContent></Card>
    {query.data.totals.settlementStatus === 'open' ? (
      <Card data-print-controls className="mx-auto max-w-2xl">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">رصيد مستحق على العميل</p>
            <p className="text-xl font-semibold tabular">{query.data.totals.balanceDue} ج.م</p>
          </div>
          <Button
            disabled={!currentCashierSession.data}
            onClick={() => setRecordingPayment(true)}
          >
            تسجيل دفعة
          </Button>
        </CardContent>
      </Card>
    ) : null}
    {query.data.status === 'completed'
      && query.data.lines.some((line) => line.itemType === 'service') ? (
      <Card data-print-controls className="mx-auto max-w-2xl">
        <CardContent className="space-y-2 p-4">
          <p className="text-sm font-medium">تصحيح موظف الخدمة</p>
          {query.data.lines.filter((line) => line.itemType === 'service').map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-3 border-t border-line pt-2">
              <span className="text-sm">{line.name} — {line.employee?.name}</span>
              <Button variant="secondary" size="sm" onClick={() => setReassignLineId(line.id)}>
                تغيير الموظف
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    ) : null}
    {reassignLineId === null ? null : (
      <ReassignEmployeeDialog
        invoice={query.data}
        line={query.data.lines.find((line) => line.id === reassignLineId)!}
        {...(branchId === undefined ? {} : { branchId })}
        onClose={() => setReassignLineId(null)}
        onUpdated={(invoice) => {
          const invoiceKey = salesQueryKeys.invoice(invoiceId, branchId);
          queryClient.setQueryData(invoiceKey, invoice);
          void invalidateErpCaches(queryClient, 'sale', invoiceKey);
        }}
      />
    )}
    {!recordingPayment || !currentCashierSession.data ? null : (
      <RecordPaymentDialog
        invoice={query.data}
        cashierSessionId={currentCashierSession.data.id}
        {...(branchId === undefined ? {} : { branchId })}
        onClose={() => setRecordingPayment(false)}
        onUpdated={(invoice) => {
          const invoiceKey = salesQueryKeys.invoice(invoiceId, branchId);
          queryClient.setQueryData(invoiceKey, invoice);
          void invalidateErpCaches(queryClient, 'sale', invoiceKey);
        }}
      />
    )}
    <InvoiceReversalControls invoice={query.data} showRefundAction={false} {...(branchId === undefined ? {} : { branchId })} onUpdated={(invoice) => {
      queryClient.setQueryData(salesQueryKeys.invoice(invoiceId, branchId), invoice);
      void invalidateErpCaches(queryClient, 'reversal');
    }} />
  </section>;
}
