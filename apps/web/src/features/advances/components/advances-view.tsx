'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListOrdered, Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react';
import { Fragment, useState } from 'react';
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
  createAdvance,
  deleteAdvance,
  listAdvances,
  updateAdvance,
  type Advance,
} from '../api/advances-api';
import {
  advanceCreateFormSchema,
  advanceUpdateFormSchema,
  type AdvanceCreateFormValues,
  type AdvanceUpdateFormValues,
} from '../schemas/advance-form';
import { advanceQueryKeys } from '../query-keys';

const ADVANCE_COLUMN_COUNT = 7;

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) {
    return (
      error.fieldErrors.amount?.[0]
      ?? error.fieldErrors.installmentCount?.[0]
      ?? error.fieldErrors.startMonth?.[0]
      ?? error.fieldErrors.employeeId?.[0]
      ?? error.message
    );
  }
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

type CreateFormInput = import('zod').input<typeof advanceCreateFormSchema>;
type UpdateFormInput = import('zod').input<typeof advanceUpdateFormSchema>;

function ScheduleFields({
  register,
  errors,
}: {
  register: ReturnType<typeof useForm<UpdateFormInput, unknown, AdvanceUpdateFormValues>>['register'];
  errors: Partial<Record<'amount' | 'installmentCount' | 'startMonth', { message?: string }>>;
}) {
  return (
    <>
      <Field label="المبلغ (ج.م)" htmlFor="advance-amount" required error={errors.amount?.message}>
        <Input
          id="advance-amount"
          dir="ltr"
          inputMode="decimal"
          className="tabular"
          {...register('amount')}
        />
      </Field>
      <Field
        label="عدد الأقساط"
        htmlFor="advance-installments"
        required
        error={errors.installmentCount?.message}
      >
        <select
          id="advance-installments"
          className="h-9 w-full rounded-control border border-line bg-paper px-3 text-sm"
          {...register('installmentCount')}
        >
          {[1, 2, 3, 4].map((count) => (
            <option key={count} value={count}>{count}</option>
          ))}
        </select>
      </Field>
      <Field
        label="شهر البداية"
        htmlFor="advance-start-month"
        required
        error={errors.startMonth?.message}
      >
        <Input id="advance-start-month" type="month" dir="ltr" {...register('startMonth')} />
      </Field>
    </>
  );
}

function AdvanceCreateForm({ onDone }: { onDone: () => void }) {
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
  } = useForm<CreateFormInput, unknown, AdvanceCreateFormValues>({
    resolver: zodResolver(advanceCreateFormSchema),
    defaultValues: { employeeId: '', amount: '', installmentCount: 1, startMonth: '' },
  });

  const save = useMutation({
    mutationFn: (values: AdvanceCreateFormValues) => createAdvance(values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: advanceQueryKeys.all });
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
        <p className="text-[13px] font-medium">سلفة جديدة</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="الموظف" htmlFor="advance-employee" required error={errors.employeeId?.message}>
            <div className="space-y-1">
              <select
                id="advance-employee"
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
          <ScheduleFields register={register} errors={errors} />
        </div>
        <p className="text-[13px] text-muted">
          تُقسم السلفة بالتساوي على أقساط شهرية متتالية، ويوضع باقي التقريب في القسط الأخير.
          تعتبر السلفة مصروفة فور إنشائها وتُقفل بالكامل بمجرد اعتماد أي قسط منها.
        </p>
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

function AdvanceEditForm({ advance, onDone }: { advance: Advance; onDone: () => void }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateFormInput, unknown, AdvanceUpdateFormValues>({
    resolver: zodResolver(advanceUpdateFormSchema),
    defaultValues: {
      amount: advance.amount,
      installmentCount: advance.installmentCount,
      startMonth: advance.startMonth,
    },
  });

  const save = useMutation({
    mutationFn: (values: AdvanceUpdateFormValues) => updateAdvance(advance.id, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: advanceQueryKeys.all });
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
        <p className="text-[13px] font-medium">تعديل سلفة {advance.employeeName}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ScheduleFields register={register} errors={errors} />
        </div>
        <p className="text-[13px] text-muted">
          يعيد التعديل إنشاء جدول الأقساط بالكامل، ولا يمكن التعديل أو الحذف بعد اعتماد أي قسط.
        </p>
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

function InstallmentsRow({ advance }: { advance: Advance }) {
  const formatters = useDisplayFormatters();
  const formatMoney = (amount: string) =>
    formatters ? formatters.formatMoney(amount) : `${amount} ج.م`;

  return (
    <tr className="border-b border-line/60 bg-ink/[0.02] last:border-b-0">
      <td colSpan={ADVANCE_COLUMN_COUNT} className="px-4 py-4">
        <dl className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          {advance.installments.map((installment) => (
            <div key={installment.id} className="flex items-center justify-between gap-4">
              <dt className="text-muted">
                قسط <span className="tabular">{installment.ordinal}</span> —{' '}
                <span className="tabular" dir="ltr">{installment.payrollMonth}</span>
              </dt>
              <dd className="tabular" dir="ltr">{formatMoney(installment.amount)}</dd>
            </div>
          ))}
        </dl>
      </td>
    </tr>
  );
}

export function AdvancesView() {
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
  const [editing, setEditing] = useState<Advance | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const advancesQuery = useQuery({
    queryKey: advanceQueryKeys.list({ search, branchFilter, monthFilter, page }),
    queryFn: () =>
      listAdvances({
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
    mutationFn: (id: number) => deleteAdvance(id),
    onSuccess: async () => {
      setConfirmDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: advanceQueryKeys.all });
    },
  });

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const items = advancesQuery.data?.items ?? [];
  const meta = advancesQuery.data?.meta;

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
          إضافة سلفة
        </Button>
      </div>

      {creating ? (
        <AdvanceCreateForm onDone={closeForm} />
      ) : editing ? (
        <AdvanceEditForm key={editing.id} advance={editing} onDone={closeForm} />
      ) : null}

      {removal.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(removal.error)}
        </p>
      ) : null}

      <Card>
        {advancesQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">جارٍ تحميل السلف…</div>
        ) : advancesQuery.isError ? (
          <EmptyState
            title="تعذر تحميل السلف"
            description={serverErrorMessage(advancesQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void advancesQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="لا توجد سلف"
            description="يمكن إضافة سلفة للموظف وتقسيطها من شهر إلى أربعة أشهر متتالية."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-4 py-2.5 text-start font-medium">الكود</th>
                  <th className="px-4 py-2.5 text-start font-medium">الموظف</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">الفرع</th>
                  <th className="px-4 py-2.5 text-start font-medium">المبلغ</th>
                  <th className="px-4 py-2.5 text-start font-medium">الأقساط</th>
                  <th className="px-4 py-2.5 text-start font-medium">شهر البداية</th>
                  <th className="px-4 py-2.5 text-start font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((advance) => (
                  <Fragment key={advance.id}>
                    <tr className="border-b border-line/60 last:border-b-0">
                      <td className="px-4 py-3">
                        <span className="tabular" dir="ltr">{advance.employeeCode}</span>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-2">
                          <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
                          {advance.employeeName}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 text-muted md:table-cell">
                        {advance.branchName}
                      </td>
                      <td className="px-4 py-3">
                        <span className="tabular">{formatMoney(advance.amount)}</span>
                      </td>
                      <td className="px-4 py-3">
                        {advance.installmentCount === 1
                          ? 'قسط واحد'
                          : advance.installmentCount === 2
                            ? 'قسطان'
                            : `${advance.installmentCount} أقساط`}
                      </td>
                      <td className="px-4 py-3">
                        <span className="tabular" dir="ltr">{advance.startMonth}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedId((current) =>
                                current === advance.id ? null : advance.id,
                              )
                            }
                          >
                            <ListOrdered className="size-4" aria-hidden />
                            الأقساط
                          </Button>
                          {advance.employeeDeletedAt !== null ? (
                            <Badge variant="neutral">موظف محذوف</Badge>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setCreating(false);
                                  setEditing(advance);
                                }}
                              >
                                <Pencil className="size-4" aria-hidden />
                                تعديل
                              </Button>
                              {confirmDeleteId === advance.id ? (
                                <>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    disabled={removal.isPending}
                                    onClick={() => removal.mutate(advance.id)}
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
                                  onClick={() => setConfirmDeleteId(advance.id)}
                                >
                                  <Trash2 className="size-4" aria-hidden />
                                  حذف
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === advance.id ? <InstallmentsRow advance={advance} /> : null}
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
            <span className="tabular">{meta.total}</span> سلفة
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
