'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ChevronDown, Pencil, Search, UserRound, Wallet } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button, Card, EmptyState, Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { formatDuration } from '@/lib/utils/format';
import { useDisplayFormatters } from '@/providers/runtime-config';

import { listBranches } from '../../branches/api/branches-api';
import { branchQueryKeys } from '../../branches/query-keys';
import { listEmployees, type Employee } from '../../employees/api/employees-api';
import { employeeQueryKeys } from '../../employees/query-keys';
import {
  finalizeBranchPayroll,
  finalizePayroll,
  listPayrollMonths,
  updateBaseSalary,
  type PayrollRecord,
} from '../api/payroll-api';
import { baseSalaryFormSchema, type BaseSalaryFormValues } from '../schemas/base-salary-form';
import { payrollQueryKeys } from '../query-keys';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) {
    return error.fieldErrors.amount?.[0] ?? error.message;
  }
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

/** Current Cairo business month as YYYY-MM. */
const currentCairoMonth = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}`;
};

function BaseSalaryEditorRow({
  employee,
  onDone,
}: {
  employee: Employee;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BaseSalaryFormValues>({
    resolver: zodResolver(baseSalaryFormSchema),
    defaultValues: { amount: employee.monthlyBaseSalary },
  });

  const save = useMutation({
    mutationFn: (values: BaseSalaryFormValues) => updateBaseSalary(employee.id, values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: payrollQueryKeys.all }),
      ]);
      onDone();
    },
  });

  return (
    <tr className="border-b border-line/60 bg-ink/[0.02] last:border-b-0">
      <td colSpan={4} className="px-4 py-4">
        <form
          noValidate
          onSubmit={handleSubmit((values) => save.mutate(values))}
          className="space-y-3"
        >
          <p className="text-[13px] font-medium">الراتب الأساسي لـ{employee.fullName}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field
              label="الراتب الأساسي الشهري (ج.م)"
              htmlFor="base-salary-amount"
              required
              error={errors.amount?.message}
            >
              <Input
                id="base-salary-amount"
                inputMode="decimal"
                className="tabular"
                {...register('amount')}
              />
            </Field>
          </div>
          <p className="text-[13px] text-muted">
            يسري الراتب الجديد على الشهر الحالي بالكامل والشهور القادمة، ولا يعيد حساب الشهور
            المنتهية أو المعتمدة.
          </p>
          {save.error ? (
            <p role="alert" className="text-[13px] text-danger">
              {serverErrorMessage(save.error)}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'جارٍ الحفظ…' : 'حفظ الراتب'}
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

function BaseSalariesSection() {
  const formatters = useDisplayFormatters();
  const formatMoney = (amount: string) =>
    formatters ? formatters.formatMoney(amount) : `${amount} ج.م`;
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<number | null>(null);

  const employeesQuery = useQuery({
    queryKey: employeeQueryKeys.list({ search, page, scope: 'base-salaries' }),
    queryFn: () => listEmployees({ ...(search ? { search } : {}), page }),
  });

  const items = employeesQuery.data?.items ?? [];
  const meta = employeesQuery.data?.meta;

  return (
    <div className="space-y-4">
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

      <Card>
        {employeesQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">جارٍ تحميل الموظفين…</div>
        ) : employeesQuery.isError ? (
          <EmptyState
            title="تعذر تحميل الموظفين"
            description={serverErrorMessage(employeesQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void employeesQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState title="لا يوجد موظفون" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-4 py-2.5 text-start font-medium">الكود</th>
                  <th className="px-4 py-2.5 text-start font-medium">الموظف</th>
                  <th className="px-4 py-2.5 text-start font-medium">الراتب الأساسي</th>
                  <th className="px-4 py-2.5 text-start font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((employee) => (
                  <Fragment key={employee.id}>
                    <tr className="border-b border-line/60 last:border-b-0">
                      <td className="px-4 py-3">
                        <span className="tabular">{employee.employeeCode}</span>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-2">
                          <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
                          {employee.fullName}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="tabular">{formatMoney(employee.monthlyBaseSalary)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditingId((current) =>
                              current === employee.id ? null : employee.id,
                            )
                          }
                        >
                          <Pencil className="size-4" aria-hidden />
                          تعديل الراتب
                        </Button>
                      </td>
                    </tr>
                    {editingId === employee.id ? (
                      <BaseSalaryEditorRow
                        key={employee.id}
                        employee={employee}
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
            صفحة <span className="tabular">{meta.page}</span> من{' '}
            <span className="tabular">{meta.totalPages}</span>
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

function MonthlyPayrollSection() {
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
                اعتماد نهائي لرواتب شهر <span className="tabular">{month}</span>؟
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

export function PayrollView() {
  const [section, setSection] = useState<'months' | 'base'>('months');

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="أقسام الرواتب">
        <Button
          role="tab"
          aria-selected={section === 'months'}
          variant={section === 'months' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setSection('months')}
        >
          رواتب الشهور
        </Button>
        <Button
          role="tab"
          aria-selected={section === 'base'}
          variant={section === 'base' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setSection('base')}
        >
          الرواتب الأساسية
        </Button>
      </div>
      {section === 'months' ? <MonthlyPayrollSection /> : <BaseSalariesSection />}
    </div>
  );
}
