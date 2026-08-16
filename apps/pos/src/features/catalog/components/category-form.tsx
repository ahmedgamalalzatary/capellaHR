'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, Field, Input } from '@capella/ui';

import { DraftNotice } from '@/components/feedback/draft-notice';
import { Select } from '@/components/form/select';
import { useFormDraft } from '@/lib/form-draft';
import { invalidateErpCaches } from '@/lib/erp-cache';

import { createCategory, updateCategory, type Category } from '../api/catalog-api';
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

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: category?.name ?? '',
      type: category?.type ?? 'service',
    } as CategoryFormValues,
  });

  const fields = watch();
  const draft = useFormDraft(
    isEdit ? null : `category:${branchId ?? 'own'}`,
    fields,
    fields.name.trim() !== '',
  );

  const branchScope = branchId === undefined ? {} : { branchId };

  const save = useMutation({
    mutationFn: (values: CategoryFormValues) => (
      isEdit
        ? updateCategory(category.id, { name: values.name, ...branchScope })
        : createCategory({ ...values, ...branchScope })
    ),
    onSuccess: async (saved) => {
      // The stored category is no longer a draft; leaving it would offer it back
      // the next time someone opens the form.
      draft.clear();
      await invalidateErpCaches(queryClient, 'catalog');
      onDone?.(saved);
    },
  });

  const formError = errors.name?.message ?? errors.type?.message ?? serverErrorMessage(save.error);

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
                setValue('type', stored.type);
              }}
              onDiscard={draft.discard}
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم التصنيف" htmlFor="category-name" required>
              <Input id="category-name" autoComplete="off" disabled={save.isPending} {...register('name')} />
            </Field>
            <Field label="النوع" htmlFor="category-type" required>
              <Select
                id="category-type"
                disabled={isEdit || save.isPending}
                {...register('type')}
              >
                <option value="service">خدمات</option>
                <option value="expense">مصروفات</option>
              </Select>
            </Field>
          </div>

          {formError ? <p role="alert" className="text-[13px] text-danger">{formError}</p> : null}

          <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'جارٍ الحفظ…' : 'حفظ التصنيف'}
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
