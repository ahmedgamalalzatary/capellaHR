'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, RotateCcw, UserRound } from 'lucide-react';
import { useState } from 'react';

import { Button, Card, EmptyState, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { formatDuration } from '@/lib/utils/format';

import { listBranches } from '../../branches/api/branches-api';
import { branchQueryKeys } from '../../branches/query-keys';
import { listEmployees } from '../../employees/api/employees-api';
import { employeeQueryKeys } from '../../employees/query-keys';
import {
  convertWeeklyDayRecord,
  listWeeklyDayRecords,
  revertWeeklyDayRecord,
  type WeeklyDayRecord,
} from '../api/weekly-day-off-api';
import { weeklyDayOffQueryKeys } from '../query-keys';

const STATUS_LABELS = {
  absence: 'غياب',
  weekly_day_off: 'يوم راحة',
} as const;

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) return error.message;
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

export function WeeklyDayOffView() {
  const queryClient = useQueryClient();
  const [employeeFilter, setEmployeeFilter] = useState<number | null>(null);
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'absence' | 'weekly_day_off' | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const recordsQuery = useQuery({
    queryKey: weeklyDayOffQueryKeys.list({
      employeeFilter, branchFilter, statusFilter, dateFrom, dateTo, page,
    }),
    queryFn: () =>
      listWeeklyDayRecords({
        ...(employeeFilter !== null ? { employeeId: employeeFilter } : {}),
        ...(branchFilter !== null ? { branchId: branchFilter } : {}),
        ...(statusFilter !== null ? { status: statusFilter } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        page,
      }),
  });

  const employeesQuery = useQuery({
    queryKey: employeeQueryKeys.options(),
    queryFn: () =>
      fetchAllPages((optionsPage) => listEmployees({ page: optionsPage, status: 'all' })),
  });
  const employees = employeesQuery.data ?? [];

  const branchesQuery = useQuery({
    queryKey: branchQueryKeys.options(),
    queryFn: () => fetchAllPages((optionsPage) => listBranches({ page: optionsPage })),
  });
  const branches = branchesQuery.data ?? [];

  const transition = useMutation({
    mutationFn: ({ record }: { record: WeeklyDayRecord }) =>
      record.status === 'absence'
        ? convertWeeklyDayRecord(record.id)
        : revertWeeklyDayRecord(record.id),
    onSuccess: async () => {
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: weeklyDayOffQueryKeys.all });
    },
  });

  const items = recordsQuery.data?.items ?? [];
  const meta = recordsQuery.data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="weekly-day-off-employee" className="text-[12px] text-muted">
            الموظف
          </label>
          <select
            id="weekly-day-off-employee"
            aria-label="تصفية حسب الموظف"
            disabled={employeesQuery.isPending || employeesQuery.isError}
            className="h-9 w-64 rounded-control border border-line bg-paper px-3 text-sm disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-70"
            value={employeeFilter ?? ''}
            onChange={(event) => {
              setPage(1);
              setEmployeeFilter(event.target.value === '' ? null : Number(event.target.value));
            }}
          >
            <option value="">
              {employeesQuery.isPending ? 'جارٍ تحميل الموظفين…' : 'كل الموظفين'}
            </option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeCode} — {employee.fullName}
              </option>
            ))}
          </select>
          {employeesQuery.isError ? (
            <div className="flex items-center gap-2 text-[12px] text-danger">
              <span>تعذر تحميل الموظفين</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void employeesQuery.refetch()}
              >
                إعادة المحاولة
              </Button>
            </div>
          ) : null}
        </div>
        <select
          aria-label="تصفية حسب الفرع"
          className="h-9 rounded-control border border-line bg-paper px-3 text-sm"
          value={branchFilter ?? ''}
          onChange={(event) => {
            setPage(1);
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
        <select
          aria-label="تصفية حسب الحالة"
          className="h-9 rounded-control border border-line bg-paper px-3 text-sm"
          value={statusFilter ?? ''}
          onChange={(event) => {
            setPage(1);
            setStatusFilter(
              event.target.value === '' ? null : (event.target.value as 'absence' | 'weekly_day_off'),
            );
          }}
        >
          <option value="">كل الحالات</option>
          <option value="absence">غياب</option>
          <option value="weekly_day_off">يوم راحة</option>
        </select>
        <label className="flex items-center gap-1 text-sm text-muted">
          من تاريخ
          <Input
            type="date"
            aria-label="من تاريخ"
            className="w-40"
            value={dateFrom}
            onChange={(event) => {
              setPage(1);
              setDateFrom(event.target.value);
            }}
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-muted">
          إلى تاريخ
          <Input
            type="date"
            aria-label="إلى تاريخ"
            className="w-40"
            value={dateTo}
            onChange={(event) => {
              setPage(1);
              setDateTo(event.target.value);
            }}
          />
        </label>
      </div>

      {transition.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(transition.error)}
        </p>
      ) : null}

      <Card>
        {recordsQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">
            جارٍ تحميل السجلات…
          </div>
        ) : recordsQuery.isError ? (
          <EmptyState
            title="تعذر تحميل سجلات الغياب وأيام الراحة"
            description={serverErrorMessage(recordsQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void recordsQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="لا توجد سجلات غياب أو أيام راحة"
            description="تُنشأ سجلات الغياب تلقائيًا بعد انتهاء اليوم، ويمكن تحويل الغياب السابق إلى يوم راحة أسبوعي."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-4 py-2.5 text-start font-medium">الكود</th>
                  <th className="px-4 py-2.5 text-start font-medium">الموظف</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">الفرع</th>
                  <th className="px-4 py-2.5 text-start font-medium">التاريخ</th>
                  <th className="px-4 py-2.5 text-start font-medium">الحالة</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">
                    مدة الوردية المطلوبة
                  </th>
                  <th className="px-4 py-2.5 text-start font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((record) => (
                  <tr key={record.id} className="border-b border-line/60 last:border-b-0">
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
                      <span className="tabular">{record.attendanceDate}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          record.status === 'weekly_day_off'
                            ? 'rounded-full bg-success/10 px-2 py-0.5 text-[12px] text-success'
                            : 'rounded-full bg-danger/10 px-2 py-0.5 text-[12px] text-danger'
                        }
                      >
                        {STATUS_LABELS[record.status]}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <span className="tabular">
                        {formatDuration(record.absenceRequiredMinutes)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={transition.isPending}
                        onClick={() => transition.mutate({ record })}
                      >
                        {record.status === 'absence' ? (
                          <>
                            <CalendarOff className="size-4" aria-hidden />
                            تعيين يوم راحة
                          </>
                        ) : (
                          <>
                            <RotateCcw className="size-4" aria-hidden />
                            إعادة إلى غياب
                          </>
                        )}
                      </Button>
                    </td>
                  </tr>
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
            <span className="tabular">{meta.total}</span> سجل
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              السابق
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              التالي
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
