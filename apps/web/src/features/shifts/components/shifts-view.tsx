'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Pencil, Search, UserRound } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, EmptyState, Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { formatDuration } from '@/lib/utils/format';

import { listBranches } from '../../branches/api/branches-api';
import { branchQueryKeys } from '../../branches/query-keys';
import {
  listShiftAssignments,
  updateShiftAssignment,
  type ShiftAssignment,
} from '../api/shifts-api';
import { shiftFormSchema, splitDuration, type ShiftFormValues } from '../schemas/shift-form';
import { shiftQueryKeys } from '../query-keys';

type ShiftFormInput = import('zod').input<typeof shiftFormSchema>;

// One structural source renders headers and determines spanning editor rows.
const shiftColumns = [
  { key: 'code', label: 'الكود', className: 'px-4 py-2.5 text-start font-medium' },
  { key: 'employee', label: 'الموظف', className: 'px-4 py-2.5 text-start font-medium' },
  { key: 'branch', label: 'الفرع', className: 'hidden px-4 py-2.5 text-start font-medium md:table-cell' },
  { key: 'duration', label: 'مدة الوردية', className: 'px-4 py-2.5 text-start font-medium' },
  { key: 'actions', label: 'إجراءات', className: 'px-4 py-2.5 text-start font-medium' },
] as const;

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) {
    return error.fieldErrors.durationMinutes?.[0] ?? error.message;
  }
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

function ShiftEditorRow({
  assignment,
  onDone,
}: {
  assignment: ShiftAssignment;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const initial = splitDuration(assignment.durationMinutes);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ShiftFormInput, unknown, ShiftFormValues>({
    resolver: zodResolver(shiftFormSchema),
    defaultValues: { hours: initial.hours, minutes: initial.minutes },
  });

  const save = useMutation({
    mutationFn: (values: ShiftFormValues) => updateShiftAssignment(assignment.employeeId, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: shiftQueryKeys.all });
      onDone();
    },
  });

  return (
    <tr className="border-b border-line/60 bg-ink/[0.02] last:border-b-0">
      <td colSpan={shiftColumns.length} className="px-4 py-4">
        <form
          noValidate
          onSubmit={handleSubmit((values) => save.mutate(values))}
          className="space-y-3"
        >
          <p className="text-[13px] font-medium">
            مدة وردية {assignment.employeeName}
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="ساعات" htmlFor="shift-hours" required error={errors.hours?.message}>
              <Input
                id="shift-hours"
                dir="ltr"
                inputMode="numeric"
                className="tabular"
                {...register('hours')}
              />
            </Field>
            <Field label="دقائق" htmlFor="shift-minutes" required error={errors.minutes?.message}>
              <Input
                id="shift-minutes"
                dir="ltr"
                inputMode="numeric"
                className="tabular"
                {...register('minutes')}
              />
            </Field>
          </div>

          <p className="text-[13px] text-muted">
            الحد الأدنى دقيقة واحدة والحد الأقصى 12 ساعة. يبدأ تطبيق المدة الجديدة من تسجيل الحضور
            التالي للموظف، وتحتفظ أي جلسة حضور مفتوحة بالمدة المسجلة عند تسجيل حضورها.
          </p>

          {save.error ? (
            <p role="alert" className="text-[13px] text-danger">
              {serverErrorMessage(save.error)}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'جارٍ الحفظ…' : 'حفظ الوردية'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={onDone}
            >
              إلغاء
            </Button>
          </div>
        </form>
      </td>
    </tr>
  );
}

export function ShiftsView() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<number | null>(null);

  const shiftsQuery = useQuery({
    queryKey: shiftQueryKeys.list({ search, branchFilter, page }),
    queryFn: () =>
      listShiftAssignments({
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

  const items = shiftsQuery.data?.items ?? [];
  const meta = shiftsQuery.data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
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
        {branchesQuery.isError ? (
          <div role="alert" className="flex items-center gap-2 rounded-control border border-danger/20 bg-danger-soft px-3 py-1.5 text-sm text-danger">
            <span>{serverErrorMessage(branchesQuery.error)}</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={branchesQuery.isFetching}
              onClick={() => void branchesQuery.refetch()}
            >
              إعادة المحاولة
            </Button>
          </div>
        ) : (
          <select
          aria-label="تصفية حسب الفرع"
          className="h-9 rounded-control border border-line bg-paper px-3 text-sm"
          value={branchFilter ?? ''}
          onChange={(event) => {
            setPage(1);
            setEditingId(null);
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
        )}
      </div>

      <Card>
        {shiftsQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">جارٍ تحميل الورديات…</div>
        ) : shiftsQuery.isError ? (
          <EmptyState
            title="تعذر تحميل الورديات"
            description={serverErrorMessage(shiftsQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void shiftsQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="لا توجد تعيينات ورديات"
            description={
              search || branchFilter !== null
                ? 'لا توجد نتائج مطابقة للبحث أو التصفية.'
                : 'يحصل كل موظف على تعيين وردية عند إضافته.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  {shiftColumns.map((column) => (
                    <th key={column.key} className={column.className}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((assignment) => (
                  <Fragment key={assignment.employeeId}>
                    <tr className="border-b border-line/60 last:border-b-0">
                      <td className="px-4 py-3">
                        <span className="tabular" dir="ltr">{assignment.employeeCode}</span>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-2">
                          <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
                          {assignment.employeeName}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 text-muted md:table-cell">
                        {assignment.branchName}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          <Clock className="size-4 shrink-0 text-muted" aria-hidden />
                          <span className="tabular" dir="ltr">
                            {formatDuration(assignment.durationMinutes)}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditingId((current) =>
                              current === assignment.employeeId ? null : assignment.employeeId,
                            )
                          }
                        >
                          <Pencil className="size-4" aria-hidden />
                          تعديل
                        </Button>
                      </td>
                    </tr>
                    {editingId === assignment.employeeId ? (
                      <ShiftEditorRow
                        key={assignment.employeeId}
                        assignment={assignment}
                        onDone={() => setEditingId(null)}
                      />
                    ) : null}
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
            صفحة <span className="tabular">{meta.page}</span> من <span className="tabular">{meta.totalPages}</span>
            {' — '}
            <span className="tabular">{meta.total}</span> موظف
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => {
                setEditingId(null);
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
                setEditingId(null);
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
