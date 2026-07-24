'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ChevronDown, Search, UserRound, Wallet } from 'lucide-react';
import { Fragment, useState } from 'react';

import { Button, Card, EmptyState, Input } from '@capella/ui';

import { fetchAllPages } from '@/lib/api/fetch-all';
import { formatDuration } from '@/lib/utils/format';
import { useDisplayFormatters } from '@/providers/runtime-config';

import { listBranches } from '../../branches/api/branches-api';
import { branchQueryKeys } from '../../branches/query-keys';
import {
  finalizeBranchPayroll,
  finalizePayroll,
  listPayrollMonths,
  type PayrollRecord,
} from '../api/payroll-api';
import { payrollQueryKeys } from '../query-keys';
import { currentCairoMonth, serverErrorMessage } from './payroll-helpers';

function PayrollBreakdownRow({ record }: { record: PayrollRecord }) {
  const formatters = useDisplayFormatters();
  const formatMoney = (amount: string) =>
    formatters ? formatters.formatMoney(amount) : `${amount} ج.م`;
  const entries: Array<[string, string]> = [
    ['الراتب الأساسي', formatMoney(record.baseSalary)],
    ['الراتب الأساسي بعد الاستحقاق', formatMoney(record.proratedBase)],
    ['مبلغ الوقت الإضافي', formatMoney(record.overtimeAmount)],
    ['المكافآت', formatMoney(record.bonusAmount)],
    ['خصومات الحضور', formatMoney(record.attendanceDeductionAmount)],
    ['الخصومات اليدوية', formatMoney(record.manualDeductionAmount)],
    ['أقساط السلف', formatMoney(record.advanceAmount)],
    ['الترحيل السالب السابق', formatMoney(record.priorNegativeCarry)],
    ['صافي الراتب', formatMoney(record.netSalary)],
    ['أيام العمل المستحقة', `${record.eligibleWorkdays} من ${record.fullMonthWorkdays}`],
    ['الدقائق المطلوبة', formatDuration(record.requiredMinutes)],
    ['دقائق الوقت الإضافي', formatDuration(record.overtimeMinutes)],
    ['دقائق العجز', formatDuration(record.shortageMinutes)],
  ];

  return (
    <tr className="border-b border-line/60 bg-ink/[0.02] last:border-b-0">
      <td colSpan={6} className="px-4 py-4">
        <dl className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          {entries.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <dt className="text-muted">{label}</dt>
              <dd className="tabular">{value}</dd>
            </div>
          ))}
        </dl>
      </td>
    </tr>
  );
}

export function MonthlyPayrollSection() {
  const queryClient = useQueryClient();
  const formatters = useDisplayFormatters();
  const formatMoney = (amount: string) =>
    formatters ? formatters.formatMoney(amount) : `${amount} ج.م`;
  const [month, setMonth] = useState(currentCairoMonth);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmFinalizeId, setConfirmFinalizeId] = useState<number | null>(null);
  const [confirmBranchFinalize, setConfirmBranchFinalize] = useState(false);

  const payrollQuery = useQuery({
    queryKey: payrollQueryKeys.list({ month, search, branchFilter, page }),
    queryFn: () =>
      listPayrollMonths({
        month,
        ...(search ? { search } : {}),
        ...(branchFilter !== null ? { branchId: branchFilter } : {}),
        page,
      }),
  });

  const branchesQuery = useQuery({
    queryKey: branchQueryKeys.options(),
    queryFn: () => fetchAllPages((optionsPage) => listBranches({ page: optionsPage })),
  });
  const branches = branchesQuery.data ?? [];
  const selectedBranch = branches.find((branch) => branch.id === branchFilter);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: payrollQueryKeys.all });
  const finalizeOne = useMutation({
    mutationFn: (record: PayrollRecord) =>
      finalizePayroll(record.employeeId, record.payrollMonth),
    onSettled: () => setConfirmFinalizeId(null),
    onSuccess: invalidate,
  });
  const finalizeBranch = useMutation({
    mutationFn: (branchId: number) => finalizeBranchPayroll(branchId, month),
    onSettled: () => setConfirmBranchFinalize(false),
    onSuccess: invalidate,
  });

  const mutationError = finalizeOne.error ?? finalizeBranch.error;
  const items = payrollQuery.data?.items ?? [];
  const meta = payrollQuery.data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm text-muted">
          شهر الراتب
          <Input
            type="month"
            aria-label="شهر الراتب"
            className="w-44"
            value={month}
            onChange={(event) => {
              if (!event.target.value) return;
              setPage(1);
              setExpandedId(null);
              setConfirmBranchFinalize(false);
              setMonth(event.target.value);
            }}
          />
        </label>
        <form
          role="search"
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(searchInput.trim());
          }}
        >
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="ابحث بالاسم أو الكود…"
            className="w-56"
          />
          <Button type="submit" variant="secondary" size="sm">
            <Search className="size-4" aria-hidden />
            بحث
          </Button>
        </form>
        <select
          aria-label="تصفية حسب الفرع"
          className="h-9 rounded-control border border-line bg-paper px-3 text-sm"
          value={branchFilter ?? ''}
          onChange={(event) => {
            setPage(1);
            setExpandedId(null);
            setConfirmBranchFinalize(false);
            setBranchFilter(event.target.value === '' ? null : Number(event.target.value));
          }}
        >
          <option value="">كل الفروع</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
        {branchFilter !== null ? (
          confirmBranchFinalize ? (
            <>
              <span className="text-[13px] text-muted">
                اعتماد نهائي لرواتب {selectedBranch?.name ?? 'الفرع المحدد'} لشهر{' '}
                <span className="tabular">{month}</span>؟
              </span>
              <Button
                variant="danger"
                size="sm"
                disabled={finalizeBranch.isPending}
                onClick={() => finalizeBranch.mutate(branchFilter)}
              >
                تأكيد اعتماد الفرع
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={finalizeBranch.isPending}
                onClick={() => setConfirmBranchFinalize(false)}
              >
                إلغاء
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmBranchFinalize(true)}
            >
              <BadgeCheck className="size-4" aria-hidden />
              اعتماد رواتب الفرع
            </Button>
          )
        ) : null}
      </div>

      <p className="text-[13px] text-muted">
        اعتماد الراتب نهائي ولا يمكن التراجع عنه، ولا يتم إلا بعد نهاية الشهر وبترتيب الشهور من
        الأقدم إلى الأحدث.
      </p>

      {mutationError ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(mutationError)}
        </p>
      ) : null}

      <Card>
        {payrollQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">جارٍ تحميل الرواتب…</div>
        ) : payrollQuery.isError ? (
          <EmptyState
            title="تعذر تحميل الرواتب"
            description={serverErrorMessage(payrollQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void payrollQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="لا توجد رواتب لهذا الشهر"
            description="لا توجد رواتب مستحقة مطابقة للشهر أو التصفية المحددة."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-4 py-2.5 text-start font-medium">الكود</th>
                  <th className="px-4 py-2.5 text-start font-medium">الموظف</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">الفرع</th>
                  <th className="px-4 py-2.5 text-start font-medium">صافي الراتب</th>
                  <th className="px-4 py-2.5 text-start font-medium">الحالة</th>
                  <th className="px-4 py-2.5 text-start font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((record) => (
                  <Fragment key={record.id}>
                    <tr className="border-b border-line/60 last:border-b-0">
                      <td className="px-4 py-3">
                        <span className="tabular">{record.employeeCode}</span>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-2">
                          <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
                          {record.employeeName}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 text-muted md:table-cell">
                        {record.branchName}
                      </td>
                      <td className="px-4 py-3">
                        <span className="tabular flex items-center gap-2">
                          <Wallet className="size-4 shrink-0 text-muted" aria-hidden />
                          {formatMoney(record.netSalary)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            record.status === 'finalized'
                              ? 'rounded-full bg-success/10 px-2 py-0.5 text-[12px] text-success'
                              : 'rounded-full bg-warning/10 px-2 py-0.5 text-[12px] text-warning'
                          }
                        >
                          {record.status === 'finalized' ? 'معتمد نهائيًا' : 'مفتوح'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedId((current) =>
                                current === record.id ? null : record.id,
                              )
                            }
                          >
                            <ChevronDown className="size-4" aria-hidden />
                            التفاصيل
                          </Button>
                          {record.status === 'open' ? (
                            confirmFinalizeId === record.id ? (
                              <>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  disabled={finalizeOne.isPending}
                                  onClick={() => finalizeOne.mutate(record)}
                                >
                                  تأكيد الاعتماد
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={finalizeOne.isPending}
                                  onClick={() => setConfirmFinalizeId(null)}
                                >
                                  إلغاء
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmFinalizeId(record.id)}
                              >
                                <BadgeCheck className="size-4" aria-hidden />
                                اعتماد
                              </Button>
                            )
                          ) : null}
                        </span>
                      </td>
                    </tr>
                    {expandedId === record.id ? <PayrollBreakdownRow record={record} /> : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted">
            صفحة <span className="tabular">{meta.page}</span> من{' '}
            <span className="tabular">{meta.totalPages}</span>
            {' — '}
            <span className="tabular">{meta.total}</span> راتب
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => {
                setExpandedId(null);
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              السابق
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => {
                setExpandedId(null);
                setPage((current) => current + 1);
              }}
            >
              التالي
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
