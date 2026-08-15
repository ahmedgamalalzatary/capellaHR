'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge, Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';

import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { Notice } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';
import { PageHeader } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { listCashierSessionBranches } from '@/features/cashier-sessions';
import { invalidateErpCaches } from '@/lib/erp-cache';

import { getInvoice, listInvoices } from '../api/sales-api';
import { salesQueryKeys } from '../query-keys';
import { formatCairoDateTime, responseMessage } from './invoice-format';
import { InvoiceReversalControls } from './invoice-reversal-controls';

const statusLabels = {
  completed: 'مكتملة',
  partially_refunded: 'مستردة جزئيًا',
  refunded: 'مستردة',
  voided: 'ملغاة',
} as const;

const statusTones = {
  completed: 'success',
  partially_refunded: 'warning',
  refunded: 'warning',
  voided: 'danger',
} as const;

function ReversalPanel({
  invoiceId,
  branchId,
  onClose,
}: {
  invoiceId: number;
  branchId?: number;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const invoice = useQuery({
    queryKey: salesQueryKeys.invoice(invoiceId, branchId),
    queryFn: () => getInvoice(invoiceId, branchId),
    retry: false,
  });

  if (invoice.isPending) return <LoadingState label="جارٍ تحميل الفاتورة…" align="start" className="p-0" />;
  if (invoice.isError) {
    return (
      <Notice tone="danger" role="alert">
        <p>{responseMessage(invoice.error)}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => void invoice.refetch()}>
          إعادة المحاولة
        </Button>
      </Notice>
    );
  }

  const { canRefund, canVoid } = invoice.data.eligibility;

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="font-mono font-semibold text-ink" dir="ltr">{invoice.data.invoiceNumber}</p>
            <p className="text-sm text-ink">
              {invoice.data.client.name} · {invoice.data.totals.total} ج.م
            </p>
            <time className="block text-[13px] text-muted" dateTime={invoice.data.soldAt}>
              {formatCairoDateTime(invoice.data.soldAt)}
            </time>
          </div>
          <Button variant="ghost" onClick={onClose}>إغلاق</Button>
        </div>
        {canRefund || canVoid ? null : (
          <p className="text-[13px] text-muted">لا يمكن استرداد أو إلغاء هذه الفاتورة.</p>
        )}
        <InvoiceReversalControls
          invoice={invoice.data}
          {...(branchId === undefined ? {} : { branchId })}
          onUpdated={(updated) => {
            queryClient.setQueryData(salesQueryKeys.invoice(invoiceId, branchId), updated);
            void invalidateErpCaches(queryClient, 'reversal');
          }}
        />
      </CardContent>
    </Card>
  );
}

export function RefundsView({ initialBranchId }: { initialBranchId?: number }) {
  const actor = useSession().data?.actor;
  const isAdmin = actor?.type === 'admin';
  const [branchId, setBranchId] = useState<number | undefined>(initialBranchId);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState<string | undefined>();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | undefined>();
  const branches = useQuery({
    queryKey: ['erp-sales', 'invoice-branches'],
    queryFn: () => listCashierSessionBranches(1),
    enabled: isAdmin,
  });
  useEffect(() => {
    if (isAdmin && branchId === undefined && branches.data?.items.length === 1) {
      setBranchId(branches.data.items[0]!.id);
    }
  }, [branchId, branches.data, isAdmin]);
  const invoices = useQuery({
    queryKey: salesQueryKeys.invoices(branchId, page, search),
    queryFn: () => listInvoices({
      ...(branchId ? { branchId } : {}),
      ...(search ? { search } : {}),
      page,
      pageSize: 20,
    }),
    enabled: Boolean(actor) && (!isAdmin || branchId !== undefined),
  });

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title="المرتجعات"
        description="اختر فاتورة مخزنة لتنفيذ استرداد جزئي أو كامل أو إلغائها دون مغادرة هذه الصفحة."
      />

      <Card className="shadow-card">
        <CardContent className="grid gap-3 p-4 sm:p-5 md:grid-cols-2 md:items-end">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchDraft.trim() || undefined);
              setPage(1);
              setSelectedInvoiceId(undefined);
            }}
          >
            <div className="grow space-y-1.5">
              <Label htmlFor="refund-invoice-search">بحث برقم الفاتورة أو العميل</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" aria-hidden />
                <Input
                  className="grow ps-9"
                  id="refund-invoice-search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                />
              </div>
            </div>
            <Button type="submit">بحث</Button>
          </form>

          {isAdmin ? (
            <div className="space-y-1.5">
              <Label htmlFor="refund-invoice-branch">الفرع</Label>
              <Select
                id="refund-invoice-branch"
                disabled={branches.isPending || branches.isError}
                value={branchId ?? ''}
                onChange={(event) => {
                  setBranchId(event.target.value ? Number(event.target.value) : undefined);
                  setPage(1);
                  setSelectedInvoiceId(undefined);
                }}
              >
                <option value="">اختر الفرع</option>
                {branches.data?.items.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </Select>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isAdmin && branches.isError ? (
        <Notice tone="danger" role="alert">
          <p>تعذر تحميل الفروع.</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void branches.refetch()}>
            إعادة المحاولة
          </Button>
        </Notice>
      ) : null}
      {invoices.isPending && (!isAdmin || branchId !== undefined) ? (
        <LoadingState label="جارٍ تحميل الفواتير…" align="start" className="p-0" />
      ) : null}
      {invoices.isError ? (
        <Notice tone="danger" role="alert">
          <p>تعذر تحميل الفواتير.</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void invoices.refetch()}>
            إعادة المحاولة
          </Button>
        </Notice>
      ) : null}
      {invoices.data?.items.length === 0 ? (
        <Card className="shadow-card">
          <EmptyState title="لا توجد فواتير" description="ستظهر الفواتير القابلة للاسترداد هنا." />
        </Card>
      ) : null}

      <ul className="space-y-2">
        {invoices.data?.items.map((invoice) => (
          <li key={invoice.id}>
            <Card className="shadow-card transition-shadow hover:shadow-raised">
              <CardContent className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-ink" dir="ltr">{invoice.invoiceNumber}</span>
                    <Badge variant={statusTones[invoice.status]}>{statusLabels[invoice.status]}</Badge>
                  </div>
                  <p className="truncate text-sm text-ink">
                    {invoice.client.name} · {invoice.assignedEmployee?.name ?? 'بدون موظف'}
                  </p>
                  <time className="block text-[13px] text-muted" dateTime={invoice.soldAt}>
                    {formatCairoDateTime(invoice.soldAt)}
                  </time>
                </div>
                <span className="flex items-center gap-3 sm:justify-end">
                  <strong className="tabular text-lg font-semibold text-ink">{invoice.total} ج.م</strong>
                  <Button
                    variant="secondary"
                    aria-label={`فتح مرتجع ${invoice.invoiceNumber}`}
                    onClick={() => setSelectedInvoiceId(
                      selectedInvoiceId === invoice.id ? undefined : invoice.id,
                    )}
                  >
                    مرتجع
                  </Button>
                </span>
              </CardContent>
            </Card>
            {selectedInvoiceId === invoice.id ? (
              <div className="mt-2">
                <ReversalPanel
                  invoiceId={invoice.id}
                  {...(branchId === undefined ? {} : { branchId })}
                  onClose={() => setSelectedInvoiceId(undefined)}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {invoices.data && invoices.data.meta.totalPages > 1 ? (
        <Card className="overflow-hidden shadow-card">
          <Pagination
            summary={(
              <>
                صفحة <span className="tabular">{page}</span> من{' '}
                <span className="tabular">{invoices.data.meta.totalPages}</span>
              </>
            )}
            previousDisabled={page <= 1}
            nextDisabled={page >= invoices.data.meta.totalPages}
            className="border-t-0"
            onPrevious={() => { setPage((value) => value - 1); setSelectedInvoiceId(undefined); }}
            onNext={() => { setPage((value) => value + 1); setSelectedInvoiceId(undefined); }}
          />
        </Card>
      ) : null}
    </section>
  );
}
