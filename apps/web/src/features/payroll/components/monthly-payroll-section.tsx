'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, CalendarCheck, ChevronDown, Search, UserCheck, UserRound, Wallet } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useState } from 'react';

import { Button, Card, ConfirmDialog, EmptyState, Input, SmartPagination } from '@capella/ui';

import { fetchAllPages } from '@/lib/api/fetch-all';
import { notifyError, notifySuccess } from '@/lib/notify';
import { formatDuration } from '@/lib/utils/format';
import { useDisplayFormatters } from '@/providers/runtime-config';

import { listBranches } from '../../branches/api/branches-api';
import { reconcileAttendanceDay } from '../../attendance/api/attendance-api';
import { invalidateAttendanceDependents } from '../../attendance/lib/invalidate-attendance';
import { branchQueryKeys } from '../../branches/query-keys';
import {
  finalizeBranchPayroll,
  finalizePayroll,
  listPayrollMonths,
  type PayrollRecord,
  type BlockedPayrollRecord,
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
    ['العمولات', formatMoney(record.commissionAmount)],
    ['خصومات الحضور', formatMoney(record.attendanceDeductionAmount)],
    ['الخصومات اليدوية', formatMoney(record.manualDeductionAmount)],
    ['خصومات عمولات سابقة', formatMoney(record.commissionDeductionAmount)],
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

function BlockedAttendanceRows({
  record,
  pendingDate,
  onResolve,
}: {
  record: BlockedPayrollRecord;
  pendingDate: string | null;
  onResolve: (attendanceDate: string, resolution: 'absence' | 'weekly_day_off') => void;
}) {
  const blockerLabels: Record<string, string> = {
    OPEN_SESSION: 'توجد جلسة حضور مفتوحة ويجب تسجيل الانصراف.',
    DENIED_ATTEMPT: 'توجد محاولة حضور مرفوضة تحتاج إلى مراجعة.',
    PAYROLL_AMOUNT_OUT_OF_RANGE: 'قيمة الراتب المحسوبة خارج النطاق المسموح.',
    ATTENDANCE_RECONCILIATION_PENDING: 'توجد أيام حضور غير مكتملة.',
  };
  return (
    <tr className="border-b border-warning/20 bg-warning/[0.04] last:border-b-0">
      <td colSpan={6} className="px-4 py-4">
        <div className="mb-3 flex items-start gap-2 text-[13px] text-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>{record.missingAttendanceDates.length
            ? 'اختر ما حدث في كل يوم ناقص. لا يمكن حساب الراتب قبل استكمال هذه الأيام.'
            : 'راجع عائق الحضور قبل اعتماد الراتب.'}</p>
        </div>
        {record.missingAttendanceDates.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-paper px-3 py-3">
            <p className="text-[13px] text-muted">
              {record.blockers.map((blocker) => blockerLabels[blocker] ?? blocker).join('، ')}
            </p>
            <Link href="/attendance" className="inline-flex h-8 items-center justify-center gap-2 rounded-control px-3 text-[13px] font-medium text-ink hover:bg-ink/5">
              <UserCheck className="size-4" aria-hidden />
              فتح الحضور والغياب
            </Link>
          </div>
        ) : <ul className="grid gap-2">
          {record.missingAttendanceDates.map((attendanceDate) => (
            <li key={attendanceDate} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-paper px-3 py-2.5">
              <time className="tabular font-medium" dateTime={attendanceDate}>{attendanceDate}</time>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="secondary" disabled={pendingDate === attendanceDate} onClick={() => onResolve(attendanceDate, 'absence')}>
                  <AlertTriangle className="size-4" aria-hidden />
                  تسجيل غياب
                </Button>
                <Button size="sm" variant="secondary" disabled={pendingDate === attendanceDate} onClick={() => onResolve(attendanceDate, 'weekly_day_off')}>
                  <CalendarCheck className="size-4" aria-hidden />
                  إجازة أسبوعية
                </Button>
                <Link href="/attendance" className="inline-flex h-8 items-center justify-center gap-2 rounded-control px-3 text-[13px] font-medium text-ink hover:bg-ink/5">
                  <UserCheck className="size-4" aria-hidden />
                  تسجيل حضور فعلي
                </Link>
              </div>
            </li>
          ))}
        </ul>}
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
  /**
   * Row identity is the employee, not `record.id`: the API returns open
   * previews with `id: 0`, so keying on `id` expands (and finalizes) every
   * open row at once. The month is fixed per list, so employeeId is unique.
   */
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<number | null>(null);
  const [confirmFinalizeEmployeeId, setConfirmFinalizeEmployeeId] = useState<number | null>(null);
  const [confirmBranchFinalize, setConfirmBranchFinalize] = useState(false);
  const [pendingResolution, setPendingResolution] = useState<{
    employeeId: number;
    employeeName: string;
    attendanceDate: string;
    resolution: 'absence' | 'weekly_day_off';
  } | null>(null);

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
    onSettled: () => setConfirmFinalizeEmployeeId(null),
    onSuccess: async () => { await invalidate(); notifySuccess('تم اعتماد الراتب.'); },
    onError: (error: unknown) => notifyError(error, 'تعذر اعتماد الراتب.'),
  });
  const finalizeBranch = useMutation({
    mutationFn: (branchId: number) => finalizeBranchPayroll(branchId, month),
    onSettled: () => setConfirmBranchFinalize(false),
    onSuccess: async () => { await invalidate(); notifySuccess('تم اعتماد رواتب الفرع.'); },
    onError: (error: unknown) => notifyError(error, 'تعذر اعتماد رواتب الفرع.'),
  });
  const reconcileDay = useMutation({
    mutationFn: (input: Parameters<typeof reconcileAttendanceDay>[0]) => reconcileAttendanceDay(input),
    onSuccess: async () => {
      await invalidateAttendanceDependents(queryClient);
      notifySuccess('تم استكمال يوم الحضور.');
    },
    onSettled: () => setPendingResolution(null),
    onError: (error: unknown) => notifyError(error, 'تعذر استكمال يوم الحضور.'),
  });

  const mutationError = finalizeOne.error ?? finalizeBranch.error;
  const items = payrollQuery.data?.items ?? [];
  const meta = payrollQuery.data?.meta;
  const finalizeTarget = items.find((record): record is PayrollRecord => (
    record.state !== 'blocked' && record.employeeId === confirmFinalizeEmployeeId
  )) ?? null;

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
              setExpandedEmployeeId(null);
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
            setExpandedEmployeeId(null);
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
            <ConfirmDialog
              title="اعتماد رواتب الفرع"
              description={
                <>
                  اعتماد نهائي لرواتب {selectedBranch?.name ?? 'الفرع المحدد'} لشهر{' '}
                  <span className="tabular">{month}</span>؟
                </>
              }
              confirmLabel="تأكيد اعتماد الفرع"
              tone="danger"
              pending={finalizeBranch.isPending}
              onConfirm={() => finalizeBranch.mutate(branchFilter)}
              onCancel={() => setConfirmBranchFinalize(false)}
            />
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

      {finalizeTarget ? (
        <ConfirmDialog
          title={`اعتماد راتب ${finalizeTarget.employeeName}`}
          description={
            <>
              اعتماد نهائي لراتب {finalizeTarget.employeeName} لشهر{' '}
              <span className="tabular">{finalizeTarget.payrollMonth}</span>؟ لا يمكن التراجع عن
              الاعتماد.
            </>
          }
          confirmLabel="تأكيد الاعتماد"
          tone="danger"
          pending={finalizeOne.isPending}
          onConfirm={() => finalizeOne.mutate(finalizeTarget)}
          onCancel={() => setConfirmFinalizeEmployeeId(null)}
        />
      ) : null}

      {pendingResolution ? (
        <ConfirmDialog
          title={pendingResolution.resolution === 'absence' ? 'تسجيل غياب' : 'تسجيل إجازة أسبوعية'}
          description={
            <>تأكيد حالة {pendingResolution.employeeName} يوم <span className="tabular">{pendingResolution.attendanceDate}</span>؟ سيؤثر هذا الاختيار في حساب الراتب.</>
          }
          confirmLabel={pendingResolution.resolution === 'absence' ? 'تأكيد تسجيل الغياب' : 'تأكيد الإجازة الأسبوعية'}
          tone="danger"
          pending={reconcileDay.isPending}
          onConfirm={() => reconcileDay.mutate({
            employeeId: pendingResolution.employeeId,
            attendanceDate: pendingResolution.attendanceDate,
            resolution: pendingResolution.resolution,
          })}
          onCancel={() => setPendingResolution(null)}
        />
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
                  <Fragment key={record.employeeId}>
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
                          {record.state === 'blocked' ? '—' : formatMoney(record.netSalary)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            record.state !== 'blocked' && record.status === 'finalized'
                              ? 'rounded-full bg-success/10 px-2 py-0.5 text-[12px] text-success'
                              : 'rounded-full bg-warning/10 px-2 py-0.5 text-[12px] text-warning'
                          }
                        >
                          {record.state === 'blocked'
                            ? 'يحتاج مراجعة الحضور'
                            : record.status === 'finalized' ? 'معتمد نهائيًا' : 'مفتوح'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedEmployeeId((current) =>
                                current === record.employeeId ? null : record.employeeId,
                              )
                            }
                          >
                            <ChevronDown className="size-4" aria-hidden />
                            {record.state === 'blocked' ? 'مراجعة الأيام' : 'التفاصيل'}
                          </Button>
                          {record.state !== 'blocked' && record.status === 'open' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmFinalizeEmployeeId(record.employeeId)}
                            >
                              <BadgeCheck className="size-4" aria-hidden />
                              اعتماد
                            </Button>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                    {expandedEmployeeId === record.employeeId ? (
                      record.state === 'blocked' ? (
                        <BlockedAttendanceRows
                          record={record}
                          pendingDate={reconcileDay.isPending ? reconcileDay.variables?.attendanceDate ?? null : null}
                          onResolve={(attendanceDate, resolution) => setPendingResolution({
                            employeeId: record.employeeId,
                            employeeName: record.employeeName,
                            attendanceDate,
                            resolution,
                          })}
                        />
                      ) : <PayrollBreakdownRow record={record} />
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {meta && meta.totalPages > 1 ? (
        <SmartPagination
          page={meta.page}
          totalPages={meta.totalPages}
            onPage={(next) => {
              setExpandedEmployeeId(null);
              setPage(next);
            }}
          summary={
            <>
              صفحة <span className="tabular">{meta.page}</span> من{' '}
              <span className="tabular">{meta.totalPages}</span>
              {' — '}
              <span className="tabular">{meta.total}</span> راتب
            </>
          }
        />
      ) : null}
    </div>
  );
}
