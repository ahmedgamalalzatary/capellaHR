'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, Field, Input } from '@capella/ui';

import { DraftNotice } from '@/components/feedback/draft-notice';
import { Select } from '@/components/form/select';
import { invalidateErpCaches } from '@/lib/erp-cache';
import { useFormDraft } from '@/lib/form-draft';

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
  const hasFixedPrice = service?.price !== null && service?.price !== undefined;

  const { register, handleSubmit, watch, setValue, formState: { errors } } =
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

  const fields = watch();
  /** A new service only: an edit is anchored to a stored row. */
  const draft = useFormDraft(
    isEdit ? null : `service:${branchId ?? 'own'}`,
    fields,
    fields.name.trim() !== '' || fields.price.trim() !== '',
  );

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
    mutationFn: (values: ServiceFormValues) => {
      if (!isEdit) return createService({ ...values, ...branchScope });
      if (!hasFixedPrice) return updateService(service.id, { ...values, ...branchScope });
      const { price: _lockedPrice, ...editableValues } = values;
      return updateService(service.id, { ...editableValues, ...branchScope });
    },
    onSuccess: async (saved) => {
      draft.clear();
      await invalidateErpCaches(queryClient, 'catalog');
      onDone?.(saved);
    },
  });

  const deletePrice = useMutation({
    mutationFn: () => updateService(service!.id, { price: null, ...branchScope }),
    onSuccess: async (saved) => {
      await invalidateErpCaches(queryClient, 'catalog');
      onDone?.(saved);
    },
  });
  const pending = save.isPending || deletePrice.isPending;

  const formError = errors.name?.message
    ?? errors.categoryId?.message
    ?? errors.price?.message
    ?? errors.commissionPercent?.message
    ?? errors.description?.message
    ?? serverErrorMessage(save.error)
    ?? serverErrorMessage(deletePrice.error);

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <form noValidate className="space-y-4" onSubmit={handleSubmit((values) => save.mutate(values))}>
          {draft.pending ? (
            <DraftNotice
              onRestore={() => {
                const stored = draft.restore();
                if (!stored) return;
                setValue('name', stored.name);
                setValue('categoryId', stored.categoryId);
                setValue('price', stored.price);
                setValue('commissionPercent', stored.commissionPercent);
                setValue('description', stored.description);
              }}
              onDiscard={draft.discard}
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم الخدمة" htmlFor="service-name" required>
              <Input id="service-name" autoComplete="off" disabled={pending} {...register('name')} />
            </Field>
            <Field label="التصنيف" htmlFor="service-category" required>
              <Select
                id="service-category"
                disabled={pending}
                {...register('categoryId')}
              >
                <option value="">اختر التصنيف…</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="السعر (ج.م)" htmlFor="service-price">
              <Input
                id="service-price"
                inputMode="decimal"
                autoComplete="off"
                className="text-start"
                disabled={pending || hasFixedPrice}
                placeholder="يحدد عند البيع إذا تُرك فارغًا"
                {...register('price')}
              />
              {hasFixedPrice ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className="mt-2"
                  disabled={pending}
                  onClick={() => deletePrice.mutate()}
                >
                  حذف السعر الثابت
                </Button>
              ) : null}
            </Field>
            <Field label="نسبة العمولة %" htmlFor="service-commission">
              <Input
                id="service-commission"
                inputMode="decimal"
                autoComplete="off"
                className="text-start"
                placeholder="0"
                disabled={pending}
                {...register('commissionPercent')}
              />
            </Field>
          </div>
          <Field label="الوصف" htmlFor="service-description">
            <Input id="service-description" autoComplete="off" disabled={pending} {...register('description')} />
          </Field>

          {formError ? <p role="alert" className="text-[13px] text-danger">{formError}</p> : null}

          <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
            <Button type="submit" disabled={pending}>
              {pending ? 'جارٍ الحفظ…' : 'حفظ الخدمة'}
            </Button>
            {onCancel ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>إلغاء</Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
