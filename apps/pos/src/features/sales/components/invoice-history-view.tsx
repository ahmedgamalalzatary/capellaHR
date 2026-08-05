'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge, Button, Card, CardContent, EmptyState, Label } from '@capella/ui';

import { useSession } from '@/features/auth';
import { listCashierSessionBranches } from '@/features/cashier-sessions';

import { listInvoices } from '../api/sales-api';
import { salesQueryKeys } from '../query-keys';

const formatCairoDateTime = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

const statusLabels = {
  completed: 'مكتملة',
  partially_refunded: 'مستردة جزئيًا',
  refunded: 'مستردة',
  voided: 'ملغاة',
} as const;

export function InvoiceHistoryView({ initialBranchId }: { initialBranchId?: number }) {
  const actor = useSession().data?.actor;
  const isAdmin = actor?.type === 'admin';
  const [branchId, setBranchId] = useState<number | undefined>(initialBranchId);
  const [page, setPage] = useState(1);
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
    queryKey: salesQueryKeys.invoices(branchId, page),
    queryFn: () => listInvoices({ ...(branchId ? { branchId } : {}), page, pageSize: 20 }),
    enabled: Boolean(actor) && (!isAdmin || branchId !== undefined),
  });

  return <section className="mx-auto max-w-5xl space-y-4">
    <div><h1 className="text-2xl font-semibold">الفواتير والإيصالات</h1><p className="text-sm text-muted">اعرض الفاتورة المخزنة وأعد طباعة إيصالها دون إعادة البيع.</p></div>
    {isAdmin ? <div className="max-w-sm space-y-1">
      <Label htmlFor="invoice-branch">الفرع</Label>
      <select id="invoice-branch" disabled={branches.isPending || branches.isError} className="w-full rounded-control border border-line bg-paper px-3 py-2" value={branchId ?? ''} onChange={(event) => { setBranchId(event.target.value ? Number(event.target.value) : undefined); setPage(1); }}>
        <option value="">اختر الفرع</option>
        {branches.data?.items.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select>
    </div> : null}
    {isAdmin && branches.isPending ? <p role="status">جارٍ تحميل الفروع…</p> : null}
    {isAdmin && branches.isError ? <div role="alert" className="rounded-control bg-danger-soft p-4 text-danger"><p>تعذر تحميل الفروع.</p><Button variant="secondary" onClick={() => void branches.refetch()}>إعادة المحاولة</Button></div> : null}
    {isAdmin && branches.data?.items.length === 0 ? <EmptyState title="لا توجد فروع" description="أضف فرعًا قبل عرض الفواتير." /> : null}
    {invoices.isPending && (!isAdmin || branchId !== undefined) ? <p role="status">جارٍ تحميل الفواتير…</p> : null}
    {invoices.isError ? <div role="alert" className="rounded-control bg-danger-soft p-4 text-danger"><p>تعذر تحميل الفواتير.</p><Button variant="secondary" onClick={() => void invoices.refetch()}>إعادة المحاولة</Button></div> : null}
    {invoices.data?.items.length === 0 ? <EmptyState title="لا توجد فواتير" description="ستظهر الفواتير المكتملة هنا." /> : null}
    <div className="space-y-2">
      {invoices.data?.items.map((invoice) => <Card key={invoice.id}><CardContent className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
        <div><div className="flex flex-wrap items-center gap-2"><Link className="font-mono font-semibold underline" dir="ltr" href={`/invoices/${invoice.id}${branchId ? `?branchId=${branchId}` : ''}`}>{invoice.invoiceNumber}</Link><Badge>{statusLabels[invoice.status]}</Badge></div><p>{invoice.client.name} · {invoice.assignedEmployee.name}</p><time className="text-sm text-muted" dateTime={invoice.soldAt}>{formatCairoDateTime(invoice.soldAt)}</time></div>
        <strong>{invoice.total} ج.م</strong>
      </CardContent></Card>)}
    </div>
    {invoices.data && invoices.data.meta.totalPages > 1 ? <div className="flex justify-between"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>السابق</Button><span>{page} / {invoices.data.meta.totalPages}</span><Button variant="secondary" disabled={page >= invoices.data.meta.totalPages} onClick={() => setPage((value) => value + 1)}>التالي</Button></div> : null}
  </section>;
}
