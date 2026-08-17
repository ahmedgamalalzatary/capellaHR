'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge, Button, Card, CardContent, EmptyState, Input, Label, Modal } from '@capella/ui';

import { DataTable, RowActions, TD, TH, THead, TR } from '@/components/data/data-table';
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
import { invoiceClientLabel } from '@/lib/client-label';

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

/**
 * The chosen invoice takes over the screen instead of unfolding under its row: a
 * reversal is one decision at a time, and the till operator should see nothing else.
 */
function ReversalDialog({
  invoiceId,
  invoiceNumber,
  branchId,
  onClose,
}: {
  invoiceId: number;
  invoiceNumber: string;
  branchId?: number;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const invoice = useQuery({
    queryKey: salesQueryKeys.invoice(invoiceId, branchId),
    queryFn: () => getInvoice(invoiceId, branchId),
    retry: false,
  });

  return (
    <Modal title={`مرتجع الفاتورة ${invoiceNumber}`} className="max-w-xl" onClose={onClose}>
      {invoice.isPending ? (
        <LoadingState label="جارٍ تحميل الفاتورة…" align="start" className="p-0" />
      ) : null}
      {invoice.isError ? (
        <Notice tone="danger" role="alert">
          <p>{responseMessage(invoice.error, 'تعذر تحميل الفاتورة.')}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void invoice.refetch()}>
            إعادة المحاولة
          </Button>
        </Notice>
      ) : null}
      {invoice.data ? (
        <>
          <div className="rounded-control border border-line bg-surface/50 p-3">
            <p className="text-sm text-ink">{invoiceClientLabel(invoice.data.client)}</p>
            <p className="tabular text-lg font-semibold text-ink">
              {invoice.data.totals.total} ج.م
            </p>
            <time className="block text-[13px] text-muted" dateTime={invoice.data.soldAt}>
              {formatCairoDateTime(invoice.data.soldAt)}
            </time>
          </div>
          {invoice.data.eligibility.canRefund || invoice.data.eligibility.canVoid ? null : (
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
        </>
      ) : null}
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>إغلاق</Button>
      </div>
    </Modal>
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
  const selectedInvoice = invoices.data?.items.find((invoice) => invoice.id === selectedInvoiceId);

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

      {invoices.data?.items.length ? (
        <Card className="overflow-hidden shadow-card">
          <DataTable>
            <THead>
              <TH>الفاتورة</TH>
              <TH>العميل</TH>
              <TH>التاريخ</TH>
              <TH numeric>الإجمالي</TH>
              <TH>الحالة</TH>
              <TH><span className="sr-only">إجراءات</span></TH>
            </THead>
            <tbody>
              {invoices.data.items.map((invoice) => (
                <TR key={invoice.id}>
                  <TD>
                    <span className="font-mono font-semibold text-ink">
                      {invoice.invoiceNumber}
                    </span>
                  </TD>
                  <TD>
                    <span className="text-ink">{invoiceClientLabel(invoice.client)}</span>
                    <span className="block text-[13px] text-muted">
                      {invoice.employees.map(({ name }) => name).join(' - ') || 'بدون موظف'}
                    </span>
                  </TD>
                  <TD>
                    <time className="text-[13px] text-muted" dateTime={invoice.soldAt}>
                      {formatCairoDateTime(invoice.soldAt)}
                    </time>
                  </TD>
                  <TD numeric>
                    <strong className="font-semibold text-ink">{invoice.total} ج.م</strong>
                  </TD>
                  <TD>
                    <Badge variant={statusTones[invoice.status]}>{statusLabels[invoice.status]}</Badge>
                  </TD>
                  <TD>
                    <RowActions>
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`فتح مرتجع ${invoice.invoiceNumber}`}
                        onClick={() => setSelectedInvoiceId(invoice.id)}
                      >
                        مرتجع
                      </Button>
                    </RowActions>
                  </TD>
                </TR>
              ))}
            </tbody>
          </DataTable>
        </Card>
      ) : null}

      {selectedInvoice ? (
        <ReversalDialog
          invoiceId={selectedInvoice.id}
          invoiceNumber={selectedInvoice.invoiceNumber}
          {...(branchId === undefined ? {} : { branchId })}
          onClose={() => setSelectedInvoiceId(undefined)}
        />
      ) : null}

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
