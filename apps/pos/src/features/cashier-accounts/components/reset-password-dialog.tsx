'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { Button, Field, Input, Modal } from '@capella/ui';

import { ApiError } from '@/lib/api/client';

import { resetCashierPassword } from '../api/cashier-accounts-api';
import { cashierAccountQueryKeys } from '../query-keys';
import {
  resetCashierPasswordFormSchema,
  type ResetCashierPasswordFormValues,
} from '../schemas/cashier-account-schemas';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

export function ResetPasswordDialog({
  accountId,
  username,
  onClose,
}: {
  accountId: number;
  username: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetCashierPasswordFormValues>({
    resolver: zodResolver(resetCashierPasswordFormSchema),
  });

  const reset = useMutation({
    mutationFn: (values: ResetCashierPasswordFormValues) =>
      resetCashierPassword(accountId, values.password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: cashierAccountQueryKeys.all });
      onClose();
    },
  });

  const formError = errors.password?.message ?? serverErrorMessage(reset.error);

  return (
    <Modal
      title={`إعادة تعيين كلمة مرور ${username}`}
      dismissOnBackdrop={!reset.isPending}
      onClose={onClose}
    >
      <form noValidate className="space-y-4" onSubmit={handleSubmit((values) => reset.mutate(values))}>
        <Field label="كلمة المرور الجديدة" htmlFor="reset-password" required>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            {...register('password')}
          />
        </Field>
        {formError ? (
          <p role="alert" className="text-[13px] text-danger">
            {formError}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={reset.isPending}>
            حفظ
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={reset.isPending} onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}
