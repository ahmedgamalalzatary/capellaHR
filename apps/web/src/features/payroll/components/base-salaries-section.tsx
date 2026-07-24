'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Search, UserRound } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button, Card, EmptyState, Field, Input } from '@capella/ui';

import { useDisplayFormatters } from '@/providers/runtime-config';

import { listEmployees, type Employee } from '../../employees/api/employees-api';
import { employeeQueryKeys } from '../../employees/query-keys';
import { updateBaseSalary } from '../api/payroll-api';
import { payrollQueryKeys } from '../query-keys';
import { baseSalaryFormSchema, type BaseSalaryFormValues } from '../schemas/base-salary-form';
import { serverErrorMessage } from './payroll-helpers';

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

export function BaseSalariesSection() {
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
