'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { CommissionSummary } from '@capella/contracts';
import { Badge, Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';

import { DataTable, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { Select } from '@/components/form/select';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
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
    <Card className="overflow-hidden shadow-card">
      <CardContent className="p-4 sm:p-5">
        <SectionHeading
          title={`تفاصيل عمولة ${summary.employeeName}`}
          description="كل قيد مرتبط ببند فاتورة، وأي عكس مرتبط بعملية الاسترداد الأصلية."
          actions={<Button variant="ghost" size="sm" onClick={onClose}>إغلاق التفاصيل</Button>}
        />
      </CardContent>
      {query.isPending ? <LoadingState label="جارٍ تحميل التفاصيل…" className="py-8" />
        : query.isError ? <EmptyState title="تعذر تحميل تفاصيل العمولة" action={<Button onClick={() => void query.refetch()}>إعادة المحاولة</Button>} />
          : !query.data.entries.length ? <EmptyState title="لا توجد قيود تفصيلية" />
            : (
              <DataTable className="border-t border-line/70">
                <THead>
                  <TH>النوع</TH>
                  <TH>الفاتورة</TH>
                  <TH>الخدمة</TH>
                  <TH numeric>الأساس</TH>
                  <TH numeric>النسبة</TH>
                  <TH numeric>العمولة</TH>
                  <TH>مرجع العكس</TH>
                </THead>
                <tbody>
                  {query.data.entries.map((entry) => (
                    <TR key={entry.id}>
                      <TD>
                        <Badge variant={entry.type === 'earned' ? 'success' : 'warning'}>
                          {entry.type === 'earned' ? 'عمولة مكتسبة' : 'عكس عمولة'}
                        </Badge>
                        <time className="mt-1 block text-xs text-muted" dateTime={entry.occurredAt}>
                          {cairoDateTime(entry.occurredAt)}
                        </time>
                      </TD>
                      <TD><span className="tabular" dir="ltr">{entry.invoiceNumber}</span></TD>
                      <TD>
                        {entry.serviceName}
                        <span className="mt-1 block text-xs text-muted">بند #{entry.lineNumber}</span>
                      </TD>
                      <TD numeric>{money(entry.baseAmount)}</TD>
                      <TD numeric>{entry.commissionRate}%</TD>
                      <TD numeric>{money(entry.amount)}</TD>
                      <TD className="tabular text-muted">
                        {entry.reversalId === null ? '—' : `#${entry.reversalId}`}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </DataTable>
            )}
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

  return (
    <section className="space-y-6">
      <PageHeader
        title="العمولات"
        description="مراجعة إجماليات الموظفين وتتبع قيود البيع والعكس."
      />

      <Card className="shadow-card">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          {branches.isError
            ? <EmptyState title="تعذر تحميل الفروع" className="py-8" action={<Button onClick={() => void branches.refetch()}>إعادة المحاولة</Button>} />
            : (
              <div className="space-y-1.5">
                <Label htmlFor="commissions-branch">الفرع</Label>
                <Select
                  id="commissions-branch"
                  aria-label="الفرع"
                  value={branchId ?? ''}
                  onChange={(event) => {
                    setBranchId(event.target.value ? Number(event.target.value) : undefined);
                    setPage(1);
                    setSelected(null);
                  }}
                >
                  <option value="">اختر الفرع</option>
                  {branches.data?.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </Select>
              </div>
            )}
          <div className="space-y-1.5">
            <Label htmlFor="commissions-month">شهر العمولة</Label>
            <Input
              id="commissions-month"
              aria-label="شهر العمولة"
              type="month"
              value={month}
              onChange={(event) => { setMonth(event.target.value); setPage(1); setSelected(null); }}
            />
          </div>
        </CardContent>
      </Card>

      {!month ? <Card className="shadow-card"><EmptyState title="اختر شهرًا لعرض العمولات" /></Card>
        : branchId === undefined ? <Card className="shadow-card"><EmptyState title="اختر فرعًا لعرض العمولات" /></Card>
          : commissions.isPending ? <Card className="shadow-card"><LoadingState label="جارٍ تحميل العمولات…" className="py-16" /></Card>
            : commissions.isError ? <Card className="shadow-card"><EmptyState title="تعذر تحميل العمولات" action={<Button onClick={() => void commissions.refetch()}>إعادة المحاولة</Button>} /></Card>
              : !commissions.data.items.length ? <Card className="shadow-card"><EmptyState title="لا توجد عمولات لهذا الشهر" /></Card>
                : (
                  <Card className="overflow-hidden shadow-card">
                    <DataTable>
                      <THead>
                        <TH>الكود</TH>
                        <TH>الموظف</TH>
                        <TH numeric>مكتسبة</TH>
                        <TH numeric>معكوسة</TH>
                        <TH numeric>الصافي</TH>
                        <TH numeric>البنود / العكس</TH>
                        <TH>الإجراء</TH>
                      </THead>
                      <tbody>
                        {commissions.data.items.map((item) => (
                          <TR key={item.employeeId}>
                            <TD className="tabular text-muted">#{item.employeeCode}</TD>
                            <TD className="font-medium">{item.employeeName}</TD>
                            <TD numeric>{money(item.earnedAmount)}</TD>
                            <TD numeric className="text-muted">{money(item.reversedAmount)}</TD>
                            <TD numeric className="font-semibold">{money(item.netAmount)}</TD>
                            <TD numeric className="text-muted">{item.invoiceLineCount} / {item.reversalCount}</TD>
                            <TD>
                              <Button size="sm" variant="ghost" onClick={() => setSelected(item)}>التفاصيل</Button>
                            </TD>
                          </TR>
                        ))}
                      </tbody>
                    </DataTable>
                    <Pagination
                      summary={<>صفحة <span className="tabular">{page}</span></>}
                      previousDisabled={page <= 1}
                      nextDisabled={page >= (commissions.data.meta.totalPages || 1)}
                      onPrevious={() => { setPage((value) => value - 1); setSelected(null); }}
                      onNext={() => { setPage((value) => value + 1); setSelected(null); }}
                    />
                  </Card>
                )}

      {selected && branchId !== undefined ? (
        <CommissionTrace summary={selected} branchId={branchId} month={month} onClose={() => setSelected(null)} />
      ) : null}
    </section>
  );
}
