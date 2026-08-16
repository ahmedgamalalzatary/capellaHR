'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useState } from 'react';

import { Button, Field, Input, Modal } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { SuccessState } from '@/components/feedback/success-state';
import { Select } from '@/components/form/select';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { invalidateErpCaches } from '@/lib/erp-cache';

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
  const [successMessage, setSuccessMessage] = useState<string>();

  const overridesQuery = useQuery({
    queryKey: catalogQueryKeys.overrides(service.id, branchId),
    queryFn: () => listCommissionOverrides(service.id, branchId),
  });
  const employeesQuery = useQuery({
    queryKey: catalogQueryKeys.employees(branchId),
    queryFn: () => fetchAllPages((page) => listCatalogEmployeeOptions(page, branchId)),
  });

  const { register, handleSubmit, reset, formState: { errors } } =
    useForm<CommissionOverrideFormInput, unknown, CommissionOverrideFormValues>({
      resolver: zodResolver(commissionOverrideFormSchema),
      defaultValues: { employeeId: '', commissionPercent: '' },
    });

  const branchScope = branchId === undefined ? {} : { branchId };
  const invalidate = () => invalidateErpCaches(queryClient, 'catalog');

  const save = useMutation({
    mutationFn: (values: CommissionOverrideFormValues) =>
      setCommissionOverride(service.id, { ...values, ...branchScope }),
    onSuccess: async () => {
      await invalidate();
      reset({ employeeId: '', commissionPercent: '' });
      setSuccessMessage('تم حفظ نسبة العمولة.');
    },
  });

  const remove = useMutation({
    mutationFn: (employeeId: number) =>
      removeCommissionOverride(service.id, employeeId, branchId),
    onSuccess: async () => { await invalidate(); setSuccessMessage('تمت إزالة نسبة العمولة.'); },
  });
  const overridePending = save.isPending || remove.isPending;

  const employees = employeesQuery.data ?? [];
  const employeeName = (id: number) =>
    employees.find((employee) => employee.id === id)?.fullName ?? `#${id}`;

  const overrides = overridesQuery.data ?? [];
  const formError = errors.employeeId?.message
    ?? errors.commissionPercent?.message
    ?? serverErrorMessage(save.error)
    ?? serverErrorMessage(remove.error)
    ?? serverErrorMessage(employeesQuery.error);

  return (
    <Modal
      title={`نسب العمولة — ${service.name}`}
      dismissOnBackdrop={!overridePending}
      onClose={onClose}
    >
      {overridesQuery.isPending ? (
        <LoadingState label="جارٍ تحميل النسب…" className="justify-start p-0" />
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
                <td className="tabular px-2 py-2">{`${override.commissionPercent}%`}</td>
                <td className="px-2 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={overridePending}
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

      {successMessage ? <SuccessState message={successMessage} /> : null}

      <form noValidate className="space-y-3" onSubmit={handleSubmit((values) => save.mutate(values))}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الموظف" htmlFor="override-employee" required>
            <Select
              id="override-employee"
              disabled={overridePending}
              {...register('employeeId')}
            >
              <option value="">اختر الموظف…</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.fullName}</option>
              ))}
            </Select>
          </Field>
          <Field label="النسبة %" htmlFor="override-percent" required>
            <Input
              id="override-percent"
              inputMode="decimal"
              autoComplete="off"
              className="text-start"
              disabled={overridePending}
              {...register('commissionPercent')}
            />
          </Field>
        </div>

        {formError ? <p role="alert" className="text-[13px] text-danger">{formError}</p> : null}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={overridePending}>
            {save.isPending ? 'جارٍ الحفظ…' : 'حفظ النسبة'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={overridePending}
            onClick={onClose}
          >
            إغلاق
          </Button>
        </div>
      </form>
    </Modal>
  );
}
