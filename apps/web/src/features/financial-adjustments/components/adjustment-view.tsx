'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Badge, Button, Card, EmptyState, Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { useDisplayFormatters } from '@/providers/runtime-config';

import { listBranches } from '../../branches/api/branches-api';
import { branchQueryKeys } from '../../branches/query-keys';
import { listEmployees } from '../../employees/api/employees-api';
import { employeeQueryKeys } from '../../employees/query-keys';
import {
  adjustmentCreateFormSchema,
  adjustmentUpdateFormSchema,
  type AdjustmentCreateFormValues,
  type AdjustmentUpdateFormValues,
} from '../schemas/adjustment-form';
import type {
  AdjustmentApi,
  AdjustmentLabels,
  FinancialAdjustment,
} from '../types';

type AdjustmentQueryKeys = {
  all: readonly string[];
  list: (filters: object) => readonly unknown[];
};

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) {
    return (
      error.fieldErrors.amount?.[0]
      ?? error.fieldErrors.payrollMonth?.[0]
      ?? error.fieldErrors.employeeId?.[0]
      ?? error.message
    );
  }
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

type CreateFormInput = import('zod').input<typeof adjustmentCreateFormSchema>;

function AdjustmentCreateForm({
  api,
  queryKeys,
  title,
  onDone,
}: {
  api: AdjustmentApi;
  queryKeys: AdjustmentQueryKeys;
  title: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const employeesQuery = useQuery({
    queryKey: employeeQueryKeys.options(),
    queryFn: () => fetchAllPages((page) => listEmployees({ page })),
  });
  const employees = employeesQuery.data ?? [];

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateFormInput, unknown, AdjustmentCreateFormValues>({
    resolver: zodResolver(adjustmentCreateFormSchema),
    defaultValues: { employeeId: '', amount: '', payrollMonth: '' },
  });

  const save = useMutation({
    mutationFn: (values: AdjustmentCreateFormValues) => api.create(values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
      onDone();
    },
  });

  return (
    <Card>
      <form
        noValidate
        onSubmit={handleSubmit((values) => save.mutate(values))}
        className="space-y-3 p-4"
      >
        <p className="text-[13px] font-medium">{title}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="الموظف" htmlFor="adjustment-employee" required error={errors.employeeId?.message}>
            <div className="space-y-1">
              <select
                id="adjustment-employee"
                disabled={employeesQuery.isPending || employeesQuery.isError}
                className="h-9 w-full rounded-control border border-line bg-paper px-3 text-sm disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-70"
                {...register('employeeId')}
              >
                <option value="">
                  {employeesQuery.isPending ? 'جارٍ تحميل الموظفين…' : 'اختر الموظف'}
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
          </Field>
          <Field label="المبلغ (ج.م)" htmlFor="adjustment-amount" required error={errors.amount?.message}>
            <Input
              id="adjustment-amount"
              dir="ltr"
              inputMode="decimal"
              className="tabular"
              {...register('amount')}
            />
          </Field>
          <Field label="شهر الراتب" htmlFor="adjustment-month" required error={errors.payrollMonth?.message}>
            <Input id="adjustment-month" type="month" dir="ltr" {...register('payrollMonth')} />
          </Field>
        </div>
        {save.error ? (
          <p role="alert" className="text-[13px] text-danger">
            {serverErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={onDone}>
            إلغاء
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AdjustmentEditForm({
  api,
  queryKeys,
  record,
  title,
  onDone,
}: {
  api: AdjustmentApi;
  queryKeys: AdjustmentQueryKeys;
  record: FinancialAdjustment;
  title: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AdjustmentUpdateFormValues>({
    resolver: zodResolver(adjustmentUpdateFormSchema),
    defaultValues: { amount: record.amount, payrollMonth: record.payrollMonth },
  });

  const save = useMutation({
    mutationFn: (values: AdjustmentUpdateFormValues) => api.update(record.id, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
      onDone();
    },
  });

  return (
    <Card>
      <form
        noValidate
        onSubmit={handleSubmit((values) => save.mutate(values))}
        className="space-y-3 p-4"
      >
        <p className="text-[13px] font-medium">
          {title} — {record.employeeName}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="المبلغ (ج.م)" htmlFor="adjustment-amount" required error={errors.amount?.message}>
            <Input
              id="adjustment-amount"
              dir="ltr"
              inputMode="decimal"
              className="tabular"
              {...register('amount')}
            />
          </Field>
          <Field label="شهر الراتب" htmlFor="adjustment-month" required error={errors.payrollMonth?.message}>
            <Input id="adjustment-month" type="month" dir="ltr" {...register('payrollMonth')} />
          </Field>
        </div>
        {save.error ? (
          <p role="alert" className="text-[13px] text-danger">
            {serverErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={onDone}>
            إلغاء
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function AdjustmentView({
  api,
  queryKeys,
  labels,
}: {
  api: AdjustmentApi;
  queryKeys: AdjustmentQueryKeys;
  labels: AdjustmentLabels;
}) {
  const queryClient = useQueryClient();
  const formatters = useDisplayFormatters();
  const formatMoney = (amount: string) =>
    formatters ? formatters.formatMoney(amount) : `${amount} ج.م`;
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [monthFilter, setMonthFilter] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FinancialAdjustment | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: queryKeys.list({ search, branchFilter, monthFilter, page }),
    queryFn: () =>
      api.list({
        ...(search ? { search } : {}),
        ...(branchFilter !== null ? { branchId: branchFilter } : {}),
        ...(monthFilter ? { payrollMonth: monthFilter } : {}),
        page,
      }),
  });

  const branchesQuery = useQuery({
    queryKey: branchQueryKeys.options(),
    queryFn: () => fetchAllPages((optionsPage) => listBranches({ page: optionsPage })),
  });
  const branches = branchesQuery.data ?? [];

  const removal = useMutation({
    mutationFn: (id: number) => api.remove(id),
    onSuccess: async () => {
      setConfirmDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
  });

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const items = listQuery.data?.items ?? [];
  const meta = listQuery.data?.meta;

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
        <Input
          type="month"
          aria-label="تصفية حسب الشهر"
          dir="ltr"
          className="w-44"
          value={monthFilter}
          onChange={(event) => {
            setPage(1);
            setMonthFilter(event.target.value);
          }}
        />
        <Button
          size="sm"
          className="ms-auto"
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
        >
          <Plus className="size-4" aria-hidden />
          {labels.addLabel}
        </Button>
      </div>

      {creating ? (
        <AdjustmentCreateForm
          api={api}
          queryKeys={queryKeys}
          title={labels.formTitleCreate}
          onDone={closeForm}
        />
      ) : editing ? (
        <AdjustmentEditForm
          key={editing.id}
          api={api}
          queryKeys={queryKeys}
          record={editing}
          title={labels.formTitleEdit}
          onDone={closeForm}
        />
      ) : null}

      {removal.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(removal.error)}
        </p>
      ) : null}

      <Card>
        {listQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">{labels.loadingText}</div>
        ) : listQuery.isError ? (
          <EmptyState
            title={labels.loadErrorTitle}
            description={serverErrorMessage(listQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void listQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState title={labels.emptyTitle} description={labels.emptyDescription} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-4 py-2.5 text-start font-medium">الكود</th>
                  <th className="px-4 py-2.5 text-start font-medium">الموظف</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">الفرع</th>
                  <th className="px-4 py-2.5 text-start font-medium">شهر الراتب</th>
                  <th className="px-4 py-2.5 text-start font-medium">المبلغ</th>
                  <th className="px-4 py-2.5 text-start font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((record) => (
                  <tr key={record.id} className="border-b border-line/60 last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="tabular" dir="ltr">{record.employeeCode}</span>
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
                      <span className="tabular" dir="ltr">{record.payrollMonth}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="tabular">{formatMoney(record.amount)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {record.employeeDeletedAt !== null ? (
                        <Badge variant="neutral">موظف محذوف</Badge>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setCreating(false);
                              setEditing(record);
                            }}
                          >
                            <Pencil className="size-4" aria-hidden />
                            تعديل
                          </Button>
                          {confirmDeleteId === record.id ? (
                            <>
                              <Button
                                variant="danger"
                                size="sm"
                                disabled={removal.isPending}
                                onClick={() => removal.mutate(record.id)}
                              >
                                تأكيد الحذف
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                إلغاء
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmDeleteId(record.id)}
                            >
                              <Trash2 className="size-4" aria-hidden />
                              حذف
                            </Button>
                          )}
                        </div>
                      )}
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
            <span className="tabular">{meta.total}</span> {labels.totalNoun}
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
