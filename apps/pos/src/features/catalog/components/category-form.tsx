'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, Field, Input } from '@capella/ui';

import { createCategory, updateCategory, type Category } from '../api/catalog-api';
import { catalogQueryKeys } from '../query-keys';
import { categoryFormSchema, type CategoryFormValues } from '../schemas/catalog-schemas';
import { serverErrorMessage } from './catalog-messages';

/**
 * The type is only offered while creating: services already point at a category,
 * so re-typing it would silently move them into the expense catalog.
 */
export function CategoryForm({
  category,
  branchId,
  onDone,
  onCancel,
}: {
  category?: Category;
  branchId?: number;
  onDone?: (saved: Category) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = category !== undefined;

  const { register, handleSubmit, formState: { errors } } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: category?.name ?? '',
      type: category?.type ?? 'service',
    } as CategoryFormValues,
  });

  const branchScope = branchId === undefined ? {} : { branchId };

  const save = useMutation({
    mutationFn: (values: CategoryFormValues) => (
      isEdit
        ? updateCategory(category.id, { name: values.name, ...branchScope })
        : createCategory({ ...values, ...branchScope })
    ),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.all });
      onDone?.(saved);
    },
  });

  const formError = errors.name?.message ?? errors.type?.message ?? serverErrorMessage(save.error);

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <form noValidate className="space-y-4" onSubmit={handleSubmit((values) => save.mutate(values))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم التصنيف" htmlFor="category-name" required>
              <Input id="category-name" autoComplete="off" {...register('name')} />
            </Field>
            <Field label="النوع" htmlFor="category-type" required>
              <select
                id="category-type"
                className="h-9 w-full rounded-control border border-line bg-paper px-3 text-sm disabled:opacity-70"
                disabled={isEdit}
                {...register('type')}
              >
                <option value="service">خدمات</option>
                <option value="expense">مصروفات</option>
              </select>
            </Field>
          </div>

          {formError ? <p role="alert" className="text-[13px] text-danger">{formError}</p> : null}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'جارٍ الحفظ…' : 'حفظ التصنيف'}
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
