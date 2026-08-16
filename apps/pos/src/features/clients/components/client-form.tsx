'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, Field, Input } from '@capella/ui';

import { DraftNotice } from '@/components/feedback/draft-notice';
import { ApiError } from '@/lib/api/client';
import { invalidateErpCaches } from '@/lib/erp-cache';
import { useFormDraft } from '@/lib/form-draft';

import { createClient, updateClient, type Client } from '../api/clients-api';
import {
  clientFormSchema,
  type ClientFormFields,
  type ClientFormValues,
} from '../schemas/client-schemas';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

export function ClientForm({
  client,
  branchId,
  defaultPhone,
  onDone,
  onCancel,
  onPendingChange,
}: {
  /** Present when editing; absent when creating. */
  client?: Client;
  /** Required when an Admin creates or edits within an explicitly selected branch. */
  branchId?: number;
  /** Pre-fills the number the cashier already typed when creating during a sale. */
  defaultPhone?: string;
  onDone?: (saved: Client) => void;
  onCancel?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = client !== undefined;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<ClientFormFields, unknown, ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      fullName: client?.fullName ?? '',
      phone: client?.phone ?? defaultPhone ?? '',
    },
  });

  const fields = watch();
  /**
   * Only a new client is remembered. An edit already has a stored record behind it,
   * and an old draft reappearing over someone else's row would be a trap.
   *
   * Dirtiness comes from the form, not from the field values: opening this during a
   * sale pre-fills the number the cashier typed into the picker, which is not work
   * the user did here and must not replace a stored draft or dismiss its offer.
   */
  const draft = useFormDraft(
    isEdit ? null : `client:${branchId ?? 'own'}`,
    fields,
    isDirty,
  );

  const save = useMutation({
    mutationFn: (values: ClientFormValues) => (
      isEdit
        ? updateClient(client.id, { ...values, ...(branchId === undefined ? {} : { branchId }) })
        : createClient({ ...values, ...(branchId === undefined ? {} : { branchId }) })
    ),
    onSuccess: async (saved) => {
      draft.clear();
      await invalidateErpCaches(queryClient, 'client');
      onDone?.(saved);
    },
  });

  const formError = errors.fullName?.message ?? errors.phone?.message ?? serverErrorMessage(save.error);

  useEffect(() => {
    onPendingChange?.(save.isPending);
    return () => onPendingChange?.(false);
  }, [onPendingChange, save.isPending]);

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <form noValidate className="space-y-4" onSubmit={handleSubmit((values) => save.mutate(values))}>
          {draft.pending ? (
            <DraftNotice
              onRestore={() => {
                const stored = draft.restore();
                if (!stored) return;
                setValue('fullName', stored.fullName, { shouldDirty: true });
                setValue('phone', stored.phone, { shouldDirty: true });
              }}
              onDiscard={draft.discard}
            />
          ) : null}
          <p className="text-[13px] text-muted">يكفي إدخال الاسم أو رقم الهاتف.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* One of the two is enough: the counter records whichever it has. */}
            <Field label="اسم العميل" htmlFor="client-name">
              <Input id="client-name" autoComplete="off" disabled={save.isPending} {...register('fullName')} />
            </Field>
            <Field label="رقم الهاتف" htmlFor="client-phone">
              <Input
                id="client-phone"
                inputMode="tel"
                autoComplete="off"
                className="text-start"
                disabled={save.isPending}
                {...register('phone')}
              />
            </Field>
          </div>

          {formError ? (
            <p role="alert" className="text-[13px] text-danger">{formError}</p>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'جارٍ الحفظ…' : isEdit ? 'حفظ التعديل' : 'إضافة العميل'}
            </Button>
            {onCancel ? (
              <Button type="button" variant="ghost" disabled={save.isPending} onClick={onCancel}>
                إلغاء
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
