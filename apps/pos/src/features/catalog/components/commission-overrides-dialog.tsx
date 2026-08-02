'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { Button, Field, Input, Modal } from '@capella/ui';

import { fetchAllPages } from '@/lib/api/fetch-all';

import {
  listCatalogEmployeeOptions,
  listCommissionOverrides,
  removeCommissionOverride,
  setCommissionOverride,
  type ServiceListItem,
} from '../api/catalog-api';
import { catalogQueryKeys } from '../query-keys';
import {
  commissionOverrideFormSchema,
  type CommissionOverrideFormInput,
  type CommissionOverrideFormValues,
} from '../schemas/catalog-schemas';
import { serverErrorMessage } from './catalog-messages';

/**
 * Per-employee commission for one service. A sale resolves the override first and
 * falls back to the service default; the invoice line snapshots whichever rate
 * applied, so editing here never changes a stored invoice.
 */
export function CommissionOverridesDialog({
  service,
  branchId,
  onClose,
}: {
  service: ServiceListItem;
  branchId?: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const overridesQuery = useQuery({
    queryKey: catalogQueryKeys.overrides(service.id, branchId),
    queryFn: () => listCommissionOverrides(service.id, branchId),
  });
  const employeesQuery = useQuery({
    queryKey: catalogQueryKeys.employees,
    queryFn: () => fetchAllPages((page) => listCatalogEmployeeOptions(page)),
  });

  const { register, handleSubmit, reset, formState: { errors } } =
    useForm<CommissionOverrideFormInput, unknown, CommissionOverrideFormValues>({
      resolver: zodResolver(commissionOverrideFormSchema),
      defaultValues: { employeeId: '', commissionPercent: '' },
    });

  const branchScope = branchId === undefined ? {} : { branchId };
  const invalidate = () => queryClient.invalidateQueries({
    queryKey: catalogQueryKeys.overrides(service.id, branchId),
  });

  const save = useMutation({
    mutationFn: (values: CommissionOverrideFormValues) =>
      setCommissionOverride(service.id, { ...values, ...branchScope }),
    onSuccess: async () => {
      await invalidate();
      reset({ employeeId: '', commissionPercent: '' });
    },
  });

  const remove = useMutation({
    mutationFn: (employeeId: number) =>
      removeCommissionOverride(service.id, employeeId, branchId),
    onSuccess: invalidate,
  });

  const employees = employeesQuery.data ?? [];
  const employeeName = (id: number) =>
    employees.find((employee) => employee.id === id)?.fullName ?? `#${id}`;

  const overrides = overridesQuery.data ?? [];
  const formError = errors.employeeId?.message
    ?? errors.commissionPercent?.message
    ?? serverErrorMessage(save.error)
    ?? serverErrorMessage(remove.error);

  return (
    <Modal title={`نسب العمولة — ${service.name}`} onClose={onClose}>
      {overridesQuery.isPending ? (
        <p className="text-[13px] text-muted">جارٍ تحميل النسب…</p>
      ) : overridesQuery.isError ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(overridesQuery.error)}
        </p>
      ) : overrides.length === 0 ? (
        <p className="text-[13px] text-muted">
          {`لا توجد نسب خاصة؛ يطبَّق افتراضي الخدمة ${service.commissionPercent}%`}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[12px] text-muted">
              <th className="px-2 py-2 text-start font-medium">الموظف</th>
              <th className="px-2 py-2 text-start font-medium">النسبة</th>
              <th className="px-2 py-2 text-start font-medium">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((override) => (
              <tr key={override.id} className="border-b border-line/60 last:border-b-0">
                <td className="px-2 py-2">{employeeName(override.employeeId)}</td>
                <td className="tabular px-2 py-2" dir="ltr">{`${override.commissionPercent}%`}</td>
                <td className="px-2 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(override.employeeId)}
                  >
                    إزالة
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form noValidate className="space-y-3" onSubmit={handleSubmit((values) => save.mutate(values))}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الموظف" htmlFor="override-employee" required>
            <select
              id="override-employee"
              className="h-9 w-full rounded-control border border-line bg-paper px-3 text-sm"
              {...register('employeeId')}
            >
              <option value="">اختر الموظف…</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.fullName}</option>
              ))}
            </select>
          </Field>
          <Field label="النسبة %" htmlFor="override-percent" required>
            <Input
              id="override-percent"
              inputMode="decimal"
              autoComplete="off"
              dir="ltr"
              className="text-start"
              {...register('commissionPercent')}
            />
          </Field>
        </div>

        {formError ? <p role="alert" className="text-[13px] text-danger">{formError}</p> : null}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? 'جارٍ الحفظ…' : 'حفظ النسبة'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>إغلاق</Button>
        </div>
      </form>
    </Modal>
  );
}
