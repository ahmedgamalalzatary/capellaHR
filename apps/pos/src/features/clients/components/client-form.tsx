'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { invalidateErpCaches } from '@/lib/erp-cache';

import { createClient, updateClient, type Client } from '../api/clients-api';
import { clientFormSchema, type ClientFormValues } from '../schemas/client-schemas';

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
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      fullName: client?.fullName ?? '',
      phone: client?.phone ?? defaultPhone ?? '',
    } as ClientFormValues,
  });

  const save = useMutation({
    mutationFn: (values: ClientFormValues) => (
      isEdit
        ? updateClient(client.id, { ...values, ...(branchId === undefined ? {} : { branchId }) })
        : createClient({ ...values, ...(branchId === undefined ? {} : { branchId }) })
    ),
    onSuccess: async (saved) => {
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
    <Card>
      <CardContent className="space-y-4 py-5">
        <form noValidate className="space-y-4" onSubmit={handleSubmit((values) => save.mutate(values))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم العميل" htmlFor="client-name" required>
              <Input id="client-name" autoComplete="off" disabled={save.isPending} {...register('fullName')} />
            </Field>
            <Field label="رقم الهاتف" htmlFor="client-phone" required>
              <Input
                id="client-phone"
                inputMode="tel"
                autoComplete="off"
                dir="ltr"
                className="text-start"
                disabled={save.isPending}
                {...register('phone')}
              />
            </Field>
          </div>

          {formError ? (
            <p role="alert" className="text-[13px] text-danger">{formError}</p>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'جارٍ الحفظ…' : isEdit ? 'حفظ التعديل' : 'إضافة العميل'}
            </Button>
            {onCancel ? (
              <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={onCancel}>
                إلغاء
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
