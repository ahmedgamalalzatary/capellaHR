'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { CommissionSummary } from '@capella/contracts';
import { Badge, Button, Card, CardContent, EmptyState, Input, Label, Modal, MonthPicker } from '@capella/ui';

import { DataTable, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { listCashierSessionBranches } from '@/features/cashier-sessions';
import { useAdminBranch } from '@/hooks/use-admin-branch';
import { ApiError } from '@/lib/api/client';
import { invalidateErpCaches } from '@/lib/erp-cache';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { notifyError, notifySuccess } from '@/lib/notify';

import { createCommissionPayout, getCommissionDetail, listCommissions } from '../api/commissions-api';
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
const isPositiveMoney = (value: string) => /^\d{1,10}\.\d{2}$/.test(value) && /[1-9]/.test(value);

function CommissionTrace({ summary, branchId, month, onClose, onPaid }: {
  summary: CommissionSummary;
  branchId?: number;
  month: string;
  onClose: () => void;
  onPaid?: (() => void) | undefined;
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
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted">الصافي: <span className="tabular font-medium text-foreground">{money(summary.netAmount)}</span></span>
          <span className="text-muted">مدفوع: <span className="tabular font-medium text-foreground">{money(summary.paidAmount)}</span></span>
          <span className="text-muted">المتاح: <span className="tabular font-semibold text-foreground">{money(summary.availableAmount)}</span></span>
          {onPaid ? <Button size="sm" onClick={onPaid}>صرف عمولة</Button> : null}
        </div>
      </CardContent>
      {query.isPending ? <LoadingState label="جارٍ تحميل التفاصيل…" className="py-8" />
        : query.isError ? <EmptyState title="تعذر تحميل تفاصيل العمولة" action={<Button onClick={() => void query.refetch()}>إعادة المحاولة</Button>} />
          : !query.data.entries.length ? <EmptyState title="لا توجد قيود تفصيلية" />
            : (
              <DataTable className="scroll-thin max-h-[65dvh] overflow-y-auto border-t border-line/70">
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
                      <TD><span className="tabular">{entry.invoiceNumber}</span></TD>
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
                {query.data.payouts.length ? (
                  <tfoot>
                    {query.data.payouts.map((payout) => (
                      <TR key={payout.id}>
                        <TD>
                          <Badge variant="neutral">صرف عمولة</Badge>
                          <time className="mt-1 block text-xs text-muted" dateTime={payout.createdAt}>
                            {cairoDateTime(payout.createdAt)}
                          </time>
                        </TD>
                        <TD colSpan={4} className="text-muted">{payout.reason ?? '—'}</TD>
                        <TD numeric className="font-semibold">{money(payout.amount)}</TD>
                        <TD className="tabular text-muted">مصروف #{payout.expenseId}</TD>
                      </TR>
                    ))}
                  </tfoot>
                ) : null}
              </DataTable>
            )}
    </Card>
  );
}

export function CommissionsView() {
  const client = useQueryClient();
  const actor = useSession().data?.actor;
  const isAdmin = actor?.type === 'admin';
  const { branchId: selectedBranchId, setBranchId } = useAdminBranch();
  const branchId = isAdmin ? selectedBranchId : undefined;
  const scopeReady = isAdmin ? branchId !== undefined : actor?.type === 'cashier';
  const [month, setMonth] = useState(currentCairoMonth);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CommissionSummary | null>(null);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutFromDetails, setPayoutFromDetails] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutReason, setPayoutReason] = useState('');
  const branches = useQuery({
    queryKey: ['erp-commissions', 'branches'],
    queryFn: () => fetchAllPages((branchPage) => listCashierSessionBranches(branchPage)),
    enabled: isAdmin,
  });
  const filters = { branchId, month, page, pageSize: 20 };
  const commissions = useQuery({
    queryKey: commissionQueryKeys.list(filters),
    queryFn: () => listCommissions({ ...(branchId === undefined ? {} : { branchId }), month, page, pageSize: 20 }),
    enabled: scopeReady && Boolean(month),
  });
  const openPayout = (summary: CommissionSummary, fromDetails = false) => {
    setSelected(summary);
    setPayoutFromDetails(fromDetails);
    setPayoutAmount(summary.availableAmount);
    setPayoutReason('');
    payout.reset();
    setPayoutOpen(true);
  };
  const closePayout = () => {
    if (payout.isPending) return;
    setPayoutOpen(false);
    if (!payoutFromDetails) setSelected(null);
    setPayoutFromDetails(false);
    setPayoutAmount('');
    setPayoutReason('');
    payout.reset();
  };
  const payout = useMutation({
    mutationFn: () => createCommissionPayout(selected!.employeeId, month, {
      amount: payoutAmount.trim(),
      ...(branchId === undefined ? {} : { branchId }),
      ...(payoutReason.trim() ? { reason: payoutReason.trim() } : {}),
    }),
    onSuccess: async (data) => {
      setPayoutOpen(false);
      setPayoutAmount('');
      setPayoutReason('');
      setSelected(payoutFromDetails ? data.summary : null);
      setPayoutFromDetails(false);
      notifySuccess('تم صرف العمولة وتسجيل مصروف الصرف.');
      await invalidateErpCaches(client, 'commission');
    },
    onError: (error: unknown) => notifyError(error),
  });
  const amountError = payoutAmount && !isPositiveMoney(payoutAmount.trim())
    ? 'أدخل مبلغًا موجبًا بصيغة 0.00'
    : undefined;
  const canPayout = Boolean(selected)
    && isPositiveMoney(payoutAmount.trim())
    && scopeReady
    && !payout.isPending;
  const summaryError = payout.error instanceof ApiError ? payout.error.message : undefined;

  return (
    <section className="space-y-6">
      <PageHeader
        title="العمولات"
        description="مراجعة إجماليات الموظفين، تتبّع القيود، وصرف جزء من العمولة خلال الشهر."
      />

      <Card className="shadow-card">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          {!isAdmin ? null : branches.isError
            ? <EmptyState title="تعذر تحميل الفروع" className="py-8" action={<Button onClick={() => void branches.refetch()}>إعادة المحاولة</Button>} />
            : (
              <div className="space-y-1.5">
                <Label htmlFor="commissions-branch">الفرع</Label>
                <Select
                  id="commissions-branch"
                  aria-label="الفرع"
                  className="w-full"
                  value={branchId ?? ''}
                  onChange={(event) => {
                    setBranchId(event.target.value ? Number(event.target.value) : undefined);
                    setPage(1);
                    setSelected(null);
                    setPayoutOpen(false);
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
            <MonthPicker
              id="commissions-month"
              filterLabel="شهر العمولة"
              className="[&>button]:w-full"
              value={month}
              onChange={(next) => { setMonth(next); setPage(1); setSelected(null); setPayoutOpen(false); }}
            />
          </div>
        </CardContent>
      </Card>

      {!month ? <Card className="shadow-card"><EmptyState title="اختر شهرًا لعرض العمولات" /></Card>
        : !scopeReady ? <Card className="shadow-card"><EmptyState title={isAdmin ? 'اختر فرعًا لعرض العمولات' : 'جارٍ تحميل العمولات…'} /></Card>
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
                        <TH numeric>مدفوع (كل الفروع)</TH>
                        <TH numeric>المتاح (كل الفروع)</TH>
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
                            <TD numeric className="text-muted">{money(item.paidAmount)}</TD>
                            <TD numeric className="font-semibold">{money(item.availableAmount)}</TD>
                            <TD numeric className="text-muted">{item.serviceUnitCount ?? item.invoiceLineCount} / {item.reversalCount}</TD>
                            <TD>
                              <div className="flex flex-wrap gap-1">
                                <Button size="sm" variant="ghost" onClick={() => setSelected(item)}>التفاصيل</Button>
                                <Button
                                  size="sm"
                                  disabled={item.availableAmount === '0.00'}
                                  onClick={() => openPayout(item)}
                                >
                                  صرف عمولة
                                </Button>
                              </div>
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
                      page={page}
                      totalPages={commissions.data.meta.totalPages}
                      onPage={(next) => { setPage(next); setSelected(null); }}
                    />
                  </Card>
                )}

      {selected && scopeReady && !payoutOpen ? (
        <Modal
          title={`تفاصيل عمولة ${selected.employeeName}`}
          className="max-w-[calc(100vw-2rem)] sm:max-w-6xl"
          onClose={() => setSelected(null)}
        >
          <CommissionTrace
            summary={selected}
            {...(branchId === undefined ? {} : { branchId })}
            month={month}
            onClose={() => setSelected(null)}
            onPaid={selected.availableAmount !== '0.00' ? () => openPayout(selected, true) : undefined}
          />
        </Modal>
      ) : null}

      {payoutOpen && selected ? (
        <Modal
          title={`صرف عمولة ${selected.employeeName}`}
          className="max-w-md"
          onClose={closePayout}
        >
          <p className="text-[13px] text-muted">
            المتاح للصرف هذا الشهر من كل الفروع: <span className="tabular font-semibold text-foreground">{money(selected.availableAmount)}</span>
            . سيتم تسجيل مصروف «صرف عمولة» في الدرج.
          </p>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="payout-amount">المبلغ</Label>
              <Input
                id="payout-amount"
                inputMode="decimal"
                value={payoutAmount}
                onChange={(event) => setPayoutAmount(event.target.value)}
                aria-invalid={amountError ? true : undefined}
              />
              {amountError ? <FieldError>{amountError}</FieldError> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-reason">السبب (اختياري)</Label>
              <Input
                id="payout-reason"
                value={payoutReason}
                maxLength={200}
                onChange={(event) => setPayoutReason(event.target.value)}
              />
            </div>
            {summaryError ? <FieldError>{summaryError}</FieldError> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={payout.isPending} onClick={closePayout}>إلغاء</Button>
              <Button disabled={!canPayout} onClick={() => payout.mutate()}>
                {payout.isPending ? 'جارٍ الصرف…' : 'تأكيد الصرف'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
