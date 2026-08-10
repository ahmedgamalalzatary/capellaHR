'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, Field, Input } from '@capella/ui';

import { Select } from '@/components/form/select';
import { invalidateErpCaches } from '@/lib/erp-cache';

import {
  createService,
  updateService,
  type Category,
  type Service,
  type ServiceListItem,
} from '../api/catalog-api';
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
  service?: ServiceListItem;
  /** All categories in scope; the form offers active service categories plus the current one. */
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
  const activeCategories = categories.filter(
    (category) => category.type === 'service' && category.isActive,
  );
  const currentCategory = service
    ? categories.find((category) => category.id === service.categoryId)
      ?? { id: service.categoryId, name: service.categoryName }
    : undefined;
  const categoryOptions = currentCategory
    && !activeCategories.some((category) => category.id === currentCategory.id)
    ? [...activeCategories, currentCategory]
    : activeCategories;

  const save = useMutation({
    mutationFn: (values: ServiceFormValues) => (
      isEdit
        ? updateService(service.id, { ...values, ...branchScope })
        : createService({ ...values, ...branchScope })
    ),
    onSuccess: async (saved) => {
      await invalidateErpCaches(queryClient, 'catalog');
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
    <Card className="shadow-card">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <form noValidate className="space-y-4" onSubmit={handleSubmit((values) => save.mutate(values))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم الخدمة" htmlFor="service-name" required>
              <Input id="service-name" autoComplete="off" disabled={save.isPending} {...register('name')} />
            </Field>
            <Field label="التصنيف" htmlFor="service-category" required>
              <Select
                id="service-category"
                disabled={save.isPending}
                {...register('categoryId')}
              >
                <option value="">اختر التصنيف…</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </Select>
            </Field>
            {/* One fixed price per service: no ranges, and the cashier never edits it. */}
            <Field label="السعر (ج.م)" htmlFor="service-price" required>
              <Input
                id="service-price"
                inputMode="decimal"
                autoComplete="off"
                dir="ltr"
                className="text-start"
                disabled={save.isPending}
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
                disabled={save.isPending}
                {...register('commissionPercent')}
              />
            </Field>
          </div>
          <Field label="الوصف" htmlFor="service-description">
            <Input id="service-description" autoComplete="off" disabled={save.isPending} {...register('description')} />
          </Field>

          {formError ? <p role="alert" className="text-[13px] text-danger">{formError}</p> : null}

          <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'جارٍ الحفظ…' : 'حفظ الخدمة'}
            </Button>
            {onCancel ? (
              <Button type="button" variant="ghost" disabled={save.isPending} onClick={onCancel}>إلغاء</Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
