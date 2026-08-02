'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, Field, Input } from '@capella/ui';

import { createService, updateService, type Category, type Service } from '../api/catalog-api';
import { catalogQueryKeys } from '../query-keys';
import {
  serviceFormSchema,
  type ServiceFormInput,
  type ServiceFormValues,
} from '../schemas/catalog-schemas';
import { serverErrorMessage } from './catalog-messages';

export function ServiceForm({
  service,
  categories,
  branchId,
  onDone,
  onCancel,
}: {
  service?: Service;
  /** Active service-type categories only: a service cannot sit under a retired one. */
  categories: Category[];
  branchId?: number;
  onDone?: (saved: Service) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = service !== undefined;

  const { register, handleSubmit, formState: { errors } } =
    useForm<ServiceFormInput, unknown, ServiceFormValues>({
      resolver: zodResolver(serviceFormSchema),
      defaultValues: {
        name: service?.name ?? '',
        categoryId: service ? String(service.categoryId) : '',
        price: service?.price ?? '',
        commissionPercent: service?.commissionPercent ?? '',
        description: service?.description ?? '',
      },
    });

  const branchScope = branchId === undefined ? {} : { branchId };

  const save = useMutation({
    mutationFn: (values: ServiceFormValues) => (
      isEdit
        ? updateService(service.id, { ...values, ...branchScope })
        : createService({ ...values, ...branchScope })
    ),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.all });
      onDone?.(saved);
    },
  });

  const formError = errors.name?.message
    ?? errors.categoryId?.message
    ?? errors.price?.message
    ?? errors.commissionPercent?.message
    ?? errors.description?.message
    ?? serverErrorMessage(save.error);

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <form noValidate className="space-y-4" onSubmit={handleSubmit((values) => save.mutate(values))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم الخدمة" htmlFor="service-name" required>
              <Input id="service-name" autoComplete="off" {...register('name')} />
            </Field>
            <Field label="التصنيف" htmlFor="service-category" required>
              <select
                id="service-category"
                className="h-9 w-full rounded-control border border-line bg-paper px-3 text-sm"
                {...register('categoryId')}
              >
                <option value="">اختر التصنيف…</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </Field>
            {/* One fixed price per service: no ranges, and the cashier never edits it. */}
            <Field label="السعر (ج.م)" htmlFor="service-price" required>
              <Input
                id="service-price"
                inputMode="decimal"
                autoComplete="off"
                dir="ltr"
                className="text-start"
                {...register('price')}
              />
            </Field>
            <Field label="نسبة العمولة %" htmlFor="service-commission">
              <Input
                id="service-commission"
                inputMode="decimal"
                autoComplete="off"
                dir="ltr"
                className="text-start"
                placeholder="0"
                {...register('commissionPercent')}
              />
            </Field>
          </div>
          <Field label="الوصف" htmlFor="service-description">
            <Input id="service-description" autoComplete="off" {...register('description')} />
          </Field>

          {formError ? <p role="alert" className="text-[13px] text-danger">{formError}</p> : null}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'جارٍ الحفظ…' : 'حفظ الخدمة'}
            </Button>
            {onCancel ? (
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>إلغاء</Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
