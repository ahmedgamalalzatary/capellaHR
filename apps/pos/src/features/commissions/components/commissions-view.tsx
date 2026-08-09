'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { CommissionSummary } from '@capella/contracts';
import { Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';

import { listCashierSessionBranches } from '@/features/cashier-sessions';
import { fetchAllPages } from '@/lib/api/fetch-all';

import { getCommissionDetail, listCommissions } from '../api/commissions-api';
import { commissionQueryKeys } from '../query-keys';

const currentCairoMonth = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}`;
};
const money = (amount: string) => `${amount} ج.م`;
const cairoDateTime = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

function CommissionTrace({ summary, branchId, month, onClose }: {
  summary: CommissionSummary;
  branchId: number;
  month: string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: commissionQueryKeys.detail(summary.employeeId, month, branchId),
    queryFn: () => getCommissionDetail(summary.employeeId, month, branchId),
  });
  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">تفاصيل عمولة {summary.employeeName}</h2>
            <p className="text-sm text-muted">كل قيد مرتبط ببند فاتورة، وأي عكس مرتبط بعملية الاسترداد الأصلية.</p>
          </div>
          <Button variant="ghost" onClick={onClose}>إغلاق التفاصيل</Button>
        </div>
        {query.isPending ? <p className="py-6 text-center text-sm text-muted">جارٍ تحميل التفاصيل…</p>
          : query.isError ? <EmptyState title="تعذر تحميل تفاصيل العمولة" action={<Button onClick={() => void query.refetch()}>إعادة المحاولة</Button>} />
            : !query.data.entries.length ? <EmptyState title="لا توجد قيود تفصيلية" />
              : <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b border-line text-muted">
                  <th className="p-3 text-start">النوع</th><th className="p-3 text-start">الفاتورة</th>
                  <th className="p-3 text-start">الخدمة</th><th className="p-3 text-start">الأساس</th>
                  <th className="p-3 text-start">النسبة</th><th className="p-3 text-start">العمولة</th>
                  <th className="p-3 text-start">مرجع العكس</th>
                </tr></thead>
                <tbody>{query.data.entries.map((entry) => <tr key={entry.id} className="border-b border-line/60">
                  <td className="p-3">{entry.type === 'earned' ? 'عمولة مكتسبة' : 'عكس عمولة'}<time className="mt-1 block text-xs text-muted" dateTime={entry.occurredAt}>{cairoDateTime(entry.occurredAt)}</time></td>
                  <td className="p-3 tabular" dir="ltr">{entry.invoiceNumber}</td>
                  <td className="p-3">{entry.serviceName}<span className="mt-1 block text-xs text-muted">بند #{entry.lineNumber}</span></td>
                  <td className="p-3 tabular">{money(entry.baseAmount)}</td>
                  <td className="p-3 tabular">{entry.commissionRate}%</td>
                  <td className="p-3 tabular">{money(entry.amount)}</td>
                  <td className="p-3 tabular">{entry.reversalId === null ? '—' : `#${entry.reversalId}`}</td>
                </tr>)}</tbody>
              </table></div>}
      </CardContent>
    </Card>
  );
}

export function CommissionsView() {
  const [branchId, setBranchId] = useState<number>();
  const [month, setMonth] = useState(currentCairoMonth);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CommissionSummary | null>(null);
  const branches = useQuery({
    queryKey: ['erp-commissions', 'branches'],
    queryFn: () => fetchAllPages((branchPage) => listCashierSessionBranches(branchPage)),
  });
  const filters = { branchId, month, page, pageSize: 20 };
  const commissions = useQuery({
    queryKey: commissionQueryKeys.list(filters),
    queryFn: () => listCommissions({ branchId: branchId!, month, page, pageSize: 20 }),
    enabled: branchId !== undefined && Boolean(month),
  });

  return <div className="mx-auto max-w-7xl space-y-4" dir="rtl">
    <Card><CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
      {branches.isError
        ? <EmptyState title="تعذر تحميل الفروع" action={<Button onClick={() => void branches.refetch()}>إعادة المحاولة</Button>} />
        : <Label>الفرع<select aria-label="الفرع" className="mt-1 h-10 w-full rounded-control border border-line bg-paper px-3" value={branchId ?? ''} onChange={(event) => { setBranchId(event.target.value ? Number(event.target.value) : undefined); setPage(1); setSelected(null); }}>
          <option value="">اختر الفرع</option>{branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select></Label>}
      <Label>شهر العمولة<Input aria-label="شهر العمولة" type="month" value={month} onChange={(event) => { setMonth(event.target.value); setPage(1); setSelected(null); }} /></Label>
    </CardContent></Card>
    {!month ? <EmptyState title="اختر شهرًا لعرض العمولات" />
      : branchId === undefined ? <EmptyState title="اختر فرعًا لعرض العمولات" />
      : commissions.isPending ? <Card><p className="p-6 text-center text-sm text-muted">جارٍ تحميل العمولات…</p></Card>
        : commissions.isError ? <EmptyState title="تعذر تحميل العمولات" action={<Button onClick={() => void commissions.refetch()}>إعادة المحاولة</Button>} />
          : !commissions.data.items.length ? <EmptyState title="لا توجد عمولات لهذا الشهر" />
            : <Card><div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b border-line text-muted">
                <th className="p-3 text-start">الكود</th><th className="p-3 text-start">الموظف</th>
                <th className="p-3 text-start">مكتسبة</th><th className="p-3 text-start">معكوسة</th>
                <th className="p-3 text-start">الصافي</th><th className="p-3 text-start">البنود / العكس</th><th className="p-3 text-start">الإجراء</th>
              </tr></thead>
              <tbody>{commissions.data.items.map((item) => <tr key={item.employeeId} className="border-b border-line/60">
                <td className="p-3 tabular">#{item.employeeCode}</td><td className="p-3 font-medium">{item.employeeName}</td>
                <td className="p-3 tabular">{money(item.earnedAmount)}</td><td className="p-3 tabular">{money(item.reversedAmount)}</td>
                <td className="p-3 tabular font-semibold">{money(item.netAmount)}</td><td className="p-3 tabular">{item.invoiceLineCount} / {item.reversalCount}</td>
                <td className="p-3"><Button size="sm" variant="ghost" onClick={() => setSelected(item)}>التفاصيل</Button></td>
              </tr>)}</tbody>
            </table></div><div className="flex justify-end gap-2 p-3">
              <Button variant="ghost" disabled={page <= 1} onClick={() => { setPage((value) => value - 1); setSelected(null); }}>السابق</Button>
              <span className="self-center text-sm">صفحة {page}</span>
              <Button variant="ghost" disabled={page >= (commissions.data.meta.totalPages || 1)} onClick={() => { setPage((value) => value + 1); setSelected(null); }}>التالي</Button>
            </div></Card>}
    {selected && branchId !== undefined ? <CommissionTrace summary={selected} branchId={branchId} month={month} onClose={() => setSelected(null)} /> : null}
  </div>;
}
